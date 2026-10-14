import {
	PERMISSION_RANK,
	type SpacePermissionLevel,
} from "../../auth/space-access.js";
import { NotFoundError } from "../../errors/http-errors.js";
import type { AuthUser } from "../../lib/auth.js";
import { objectTypeService } from "../object-types/service.js";
import type { ObjectFilterInput } from "../objects/filters.js";
import { objectService } from "../objects/service.js";
import { relationService } from "../relations/service.js";
import { bookingObject, reviewObject, vanObject } from "./backfill.js";
import { type CatalogVan, vanFromObject } from "./catalog.js";
import { VAN_LIFE_SPACE_ID, VAN_LIFE_SPACE_NAME } from "./constants.js";
import {
	VAN_LIFE_RELATIONS,
	VAN_LIFE_TYPES,
	type VanLifeTypeIds,
} from "./registry.js";
import { vanLifeRepository } from "./repository.js";

const REGISTRY_PAGE_SIZE = 100;

// One shared space means the coarse rank cannot tell a host from a renter: a
// renter writes their own bookings, and those are objects here. Which rows are
// "yours" is decided per route by `creatorId`, not by this rank.
async function ensureVanLifeSpace(user: AuthUser) {
	const space = await vanLifeRepository.findOrCreateSpace(
		VAN_LIFE_SPACE_ID,
		VAN_LIFE_SPACE_NAME,
		user.id,
	);

	const wanted: SpacePermissionLevel = "writer";
	const member = await vanLifeRepository.findMembership(space.id, user.id);

	if (!member || PERMISSION_RANK[member.permission] < PERMISSION_RANK[wanted]) {
		await vanLifeRepository.enrol(space.id, user.id, wanted);
	}

	return space.id;
}

async function everyPage<T>(
	load: (page: number) => Promise<{ data: T[]; meta: { totalPages: number } }>,
) {
	const found: T[] = [];

	for (let page = 1; ; page += 1) {
		const result = await load(page);

		found.push(...result.data);

		if (page >= result.meta.totalPages) {
			return found;
		}
	}
}

async function ensureVanLifeTypes(
	user: AuthUser,
	spaceId: string,
): Promise<VanLifeTypeIds> {
	const knownRelations = new Set(
		(
			await everyPage((page) =>
				relationService.findMany(user, spaceId, {
					page,
					limit: REGISTRY_PAGE_SIZE,
					sort: "createdAt",
					order: "asc",
				}),
			)
		).map((relation) => relation.uniqueKey),
	);

	for (const relation of VAN_LIFE_RELATIONS) {
		if (!knownRelations.has(relation.uniqueKey)) {
			await relationService.create(user, spaceId, relation);
		}
	}

	const knownTypes = new Map(
		(
			await everyPage((page) =>
				objectTypeService.findMany(user, spaceId, {
					page,
					limit: REGISTRY_PAGE_SIZE,
					sort: "createdAt",
					order: "asc",
				}),
			)
		).map((type) => [type.uniqueKey, type.id]),
	);

	for (const type of VAN_LIFE_TYPES) {
		const existingId = knownTypes.get(type.uniqueKey);

		if (existingId) {
			// The generator owns the shape, so a type that already exists still
			// takes on the relations it is defined to carry.
			await relationService.attachKeys(
				spaceId,
				existingId,
				type.relationKeys ?? [],
			);
			continue;
		}

		const created = await objectTypeService.create(user, spaceId, type);

		knownTypes.set(type.uniqueKey, created.id);
	}

	return Object.fromEntries(
		VAN_LIFE_TYPES.map((type) => [
			type.uniqueKey,
			knownTypes.get(type.uniqueKey),
		]),
	) as VanLifeTypeIds;
}

async function preparedRegistry(user: AuthUser) {
	const spaceId = await ensureVanLifeSpace(user);

	return { spaceId, types: await ensureVanLifeTypes(user, spaceId) };
}

async function mirrorVanRow(vanId: string, spaceId: string, typeId: string) {
	const van = await vanLifeRepository.findLegacyVanById(vanId);

	if (!van) {
		return;
	}

	await vanLifeRepository.upsertObject({
		...vanObject(van),
		spaceId,
		typeId,
	});
}

async function mirrorBookingRow(
	bookingId: string,
	spaceId: string,
	types: VanLifeTypeIds,
) {
	const booking = await vanLifeRepository.findLegacyBookingById(bookingId);

	if (!booking) {
		return;
	}

	// An edge points at an object, so whatever a row depends on is mirrored first.
	await mirrorVanRow(booking.vanId, spaceId, types.van);
	await vanLifeRepository.upsertObject({
		...bookingObject(booking),
		spaceId,
		typeId: types.booking,
	});
	await vanLifeRepository.upsertEdge({
		spaceId,
		fromId: booking.id,
		toId: booking.vanId,
		relationKey: "van",
	});
}

// The legacy tables stay the source of truth for a write - they hold the overlap
// transaction and the one-review-per-booking index - and this projects the row
// that write committed into the object core.
async function mirrorVan(user: AuthUser, vanId: string) {
	const { spaceId, types } = await preparedRegistry(user);

	await mirrorVanRow(vanId, spaceId, types.van);
}

async function mirrorBooking(user: AuthUser, bookingId: string) {
	const { spaceId, types } = await preparedRegistry(user);

	await mirrorBookingRow(bookingId, spaceId, types);
}

async function mirrorReview(user: AuthUser, reviewId: string) {
	const { spaceId, types } = await preparedRegistry(user);
	const review = await vanLifeRepository.findLegacyReviewById(reviewId);

	if (!review) {
		return;
	}

	await mirrorBookingRow(review.bookingId, spaceId, types);
	await vanLifeRepository.upsertObject({
		...reviewObject(review),
		spaceId,
		typeId: types.review,
	});
	await vanLifeRepository.upsertEdge({
		spaceId,
		fromId: review.id,
		toId: review.vanId,
		relationKey: "van",
	});
	await vanLifeRepository.upsertEdge({
		spaceId,
		fromId: review.id,
		toId: review.bookingId,
		relationKey: "booking",
	});
}

async function backfillVanLife(user: AuthUser, spaceId: string) {
	const types = await ensureVanLifeTypes(user, spaceId);

	const vans = await vanLifeRepository.findLegacyVans();

	for (const van of vans) {
		await vanLifeRepository.upsertObject({
			...vanObject(van),
			spaceId,
			typeId: types.van,
		});
	}

	const bookings = await vanLifeRepository.findLegacyBookings();

	for (const booking of bookings) {
		await mirrorBookingRow(booking.id, spaceId, types);
	}

	const reviews = await vanLifeRepository.findLegacyReviews();

	for (const review of reviews) {
		await mirrorBookingRow(review.bookingId, spaceId, types);
		await vanLifeRepository.upsertObject({
			...reviewObject(review),
			spaceId,
			typeId: types.review,
		});
		await vanLifeRepository.upsertEdge({
			spaceId,
			fromId: review.id,
			toId: review.vanId,
			relationKey: "van",
		});
		await vanLifeRepository.upsertEdge({
			spaceId,
			fromId: review.id,
			toId: review.bookingId,
			relationKey: "booking",
		});
	}

	return {
		vans: vans.length,
		bookings: bookings.length,
		reviews: reviews.length,
	};
}

// A host's own desk reads the object core. Every page is fetched because the
// legacy route listed every van the host had, with no page size of its own.
async function findHostVans(
	user: AuthUser,
	query: { key: string; order: "asc" | "desc"; search?: string },
): Promise<CatalogVan[]> {
	const { spaceId, types } = await preparedRegistry(user);
	const filters: ObjectFilterInput[] = [
		{ key: "typeId", operator: "equal", value: types.van },
		{ key: "creatorId", operator: "equal", value: user.id },
		{ key: "isArchived", operator: "equal", value: false },
	];

	if (query.search) {
		const term = `%${query.search}%`;

		filters.push({
			conjunction: "or",
			filters: [
				{ key: "name", operator: "like", value: term },
				{ key: "location", operator: "like", value: term },
				{ key: "description", operator: "like", value: term },
			],
		});
	}

	const vans: CatalogVan[] = [];

	for (let page = 1; ; page += 1) {
		const listed = await objectService.list(user, spaceId, {
			filters,
			sorts: [{ key: query.key, order: query.order }],
			layouts: [],
			page,
			limit: REGISTRY_PAGE_SIZE,
		});

		vans.push(...listed.data.map(vanFromObject));

		if (page >= listed.meta.totalPages) {
			return vans;
		}
	}
}

async function findHostVan(user: AuthUser, vanId: string): Promise<CatalogVan> {
	await preparedRegistry(user);
	const object = await objectService.findById(user, vanId);

	if (object.creatorId !== user.id || object.isArchived) {
		throw new NotFoundError("Van not found.");
	}

	return vanFromObject(object);
}

// The planner's catalog question, answered against the object core: a place, a
// nightly budget, and never a retired van. Cheapest first, because the budget is
// what the traveller is negotiating.
async function searchListedVans(
	user: AuthUser,
	spaceId: string,
	query: { location?: string; maxPrice?: number; limit: number },
): Promise<CatalogVan[]> {
	const types = await ensureVanLifeTypes(user, spaceId);
	const filters: ObjectFilterInput[] = [
		{ key: "typeId", operator: "equal", value: types.van },
		{ key: "isArchived", operator: "equal", value: false },
	];

	if (query.location) {
		filters.push({
			key: "location",
			operator: "like",
			value: `%${query.location}%`,
		});
	}

	if (query.maxPrice !== undefined) {
		filters.push({
			key: "price",
			operator: "lessOrEqual",
			value: query.maxPrice,
		});
	}

	const listed = await objectService.list(user, spaceId, {
		filters,
		sorts: [{ key: "price", order: "asc" }],
		layouts: [],
		page: 1,
		limit: query.limit,
	});

	return listed.data.map(vanFromObject);
}

// A van the planner has in mind, but only while it is still on the books: an
// unknown id, a non-van object or a retired van all answer as absent.
async function findListedVan(
	user: AuthUser,
	spaceId: string,
	vanId: string,
): Promise<CatalogVan | undefined> {
	const types = await ensureVanLifeTypes(user, spaceId);
	const object = await objectService
		.findById(user, vanId)
		.catch((error: unknown) => {
			if (error instanceof NotFoundError) {
				return undefined;
			}

			throw error;
		});

	if (!object || object.typeId !== types.van || object.isArchived) {
		return undefined;
	}

	return vanFromObject(object);
}

export const vanLifeService = {
	ensureVanLifeSpace,
	ensureVanLifeTypes,
	backfillVanLife,
	searchListedVans,
	findListedVan,
	mirrorVan,
	mirrorBooking,
	mirrorReview,
	findHostVans,
	findHostVan,
};
