import { isAdmin, isHost } from "../../auth/roles.js";
import {
	PERMISSION_RANK,
	type SpacePermissionLevel,
} from "../../auth/space-access.js";
import type { AuthUser } from "../../lib/auth.js";
import { objectTypeService } from "../object-types/service.js";
import { relationService } from "../relations/service.js";
import { bookingObject, reviewObject, vanObject } from "./backfill.js";
import { VAN_LIFE_SPACE_ID, VAN_LIFE_SPACE_NAME } from "./constants.js";
import {
	VAN_LIFE_RELATIONS,
	VAN_LIFE_TYPES,
	type VanLifeTypeIds,
} from "./registry.js";
import { vanLifeRepository } from "./repository.js";

const REGISTRY_PAGE_SIZE = 100;

function rankFor(user: AuthUser): SpacePermissionLevel {
	return isHost(user) || isAdmin(user) ? "writer" : "reader";
}

// The legacy routes never named a space, so the use case owns exactly one and
// enrols whoever knocks. An existing member is only ever raised, never lowered.
async function ensureVanLifeSpace(user: AuthUser) {
	const space = await vanLifeRepository.findOrCreateSpace(
		VAN_LIFE_SPACE_ID,
		VAN_LIFE_SPACE_NAME,
		user.id,
	);

	const wanted = rankFor(user);
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

	const reviews = await vanLifeRepository.findLegacyReviews();

	for (const review of reviews) {
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

export const vanLifeService = {
	ensureVanLifeSpace,
	ensureVanLifeTypes,
	backfillVanLife,
};
