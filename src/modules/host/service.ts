import { isHost } from "../../auth/roles.js";
import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	NotFoundError,
} from "../../errors/http-errors.js";
import { BookingStatus } from "../../generated/prisma/client.js";
import type { AuthUser } from "../../lib/auth.js";
import { translatePrismaError } from "../../lib/prisma-error.js";
import {
	createPaginationMeta,
	getPagination,
	getSorting,
} from "../../pagination/index.js";
import {
	DEFAULT_BOOKING_SORT_FIELD,
	DEFAULT_BOOKING_SORT_ORDER,
} from "../bookings/constants.js";
import { vanLifeService } from "../vanlife/service.js";
import { toVanSummary } from "../vans/dto.js";
import {
	toDashboard,
	toHostBooking,
	toHostVan,
	toIncome,
	toReviews,
} from "./dto.js";
import { hostRepository } from "./repository.js";
import type {
	CreateHostVan,
	HostBookingListQuery,
	HostStatsQuery,
	HostVanListQuery,
	UpdateHostBookingStatus,
	UpdateHostVan,
} from "./schema.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function ensureHost(user: AuthUser) {
	if (!isHost(user)) {
		throw new ForbiddenError("You need a host account to access this.");
	}
}

function getDaysAgo(days: number) {
	const now = new Date();

	return new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
			days * DAY_IN_MS,
	);
}

function getTodayUtc() {
	const now = new Date();

	return new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
}

function assertAllowedBookingTransition(
	currentStatus: BookingStatus,
	nextStatus: UpdateHostBookingStatus["status"],
) {
	const allowedTransitions: Record<BookingStatus, BookingStatus[]> = {
		[BookingStatus.pending]: [BookingStatus.confirmed, BookingStatus.cancelled],
		[BookingStatus.confirmed]: [
			BookingStatus.completed,
			BookingStatus.cancelled,
		],
		[BookingStatus.completed]: [],
		[BookingStatus.cancelled]: [],
	};

	if (!allowedTransitions[currentStatus].includes(nextStatus)) {
		throw new BadRequestError("Invalid booking status transition.");
	}
}

async function findVans(user: AuthUser, query: HostVanListQuery) {
	ensureHost(user);

	const vans = await vanLifeService.findHostVans(user, {
		key: query.sort,
		order: query.order,
		search: query.search,
	});

	return vans.map(toVanSummary);
}

async function findVanById(user: AuthUser, id: string) {
	ensureHost(user);

	return toHostVan(await vanLifeService.findHostVan(user, id));
}

async function createVan(user: AuthUser, input: CreateHostVan) {
	ensureHost(user);

	const van = await hostRepository.createVan({
		host: {
			connect: {
				id: user.id,
			},
		},
		name: input.name,
		price: input.price,
		description: input.description,
		imageUrl: input.imageUrl,
		type: input.type,
		location: input.location,
		sleeps: input.sleeps,
		amenities: input.amenities,
	});

	await vanLifeService.mirrorVan(user, van.id);

	return toHostVan(van);
}

async function updateVan(user: AuthUser, id: string, input: UpdateHostVan) {
	ensureHost(user);

	try {
		const van = await hostRepository.updateOwnedVan(user.id, id, input);

		await vanLifeService.mirrorVan(user, van.id);

		return toHostVan(van);
	} catch (error) {
		translatePrismaError(error, {
			notFound: "Van not found.",
		});
	}
}

async function deleteVan(user: AuthUser, id: string) {
	ensureHost(user);

	try {
		const van = await hostRepository.archiveOwnedVan(user.id, id);

		await vanLifeService.mirrorVan(user, van.id);
	} catch (error) {
		translatePrismaError(error, {
			notFound: "Van not found.",
		});
	}
}

async function getDashboard(user: AuthUser, query: HostStatsQuery) {
	ensureHost(user);
	const since = getDaysAgo(query.days);

	const [income, bookingCount, reviewScore, reviewCount, listedVanCount] =
		await Promise.all([
			hostRepository.getIncome(user.id, since),
			hostRepository.countRangeBookings(user.id, since),
			hostRepository.getAverageReviewScore(user.id, since),
			hostRepository.countReviews(user.id, since),
			hostRepository.countListedVans(user.id),
		]);

	return toDashboard({
		days: query.days,
		income: income._sum.totalPrice ?? 0,
		bookingCount,
		averageReviewScore: reviewScore._avg.rating,
		reviewCount,
		listedVanCount,
	});
}

async function getIncome(user: AuthUser, query: HostStatsQuery) {
	ensureHost(user);

	const bookings = await hostRepository.findIncomeBookings(
		user.id,
		getDaysAgo(query.days),
	);

	return toIncome({
		days: query.days,
		bookings,
	});
}

async function getReviews(user: AuthUser, query: HostStatsQuery) {
	ensureHost(user);
	const since = getDaysAgo(query.days);

	const [reviews, ratingCounts] = await Promise.all([
		hostRepository.findReviews(user.id, since),
		hostRepository.getRatingCounts(user.id, since),
	]);

	return toReviews({
		days: query.days,
		overallRating:
			reviews.length === 0
				? null
				: reviews.reduce((total, review) => total + review.rating, 0) /
					reviews.length,
		ratingCounts: new Map(
			ratingCounts.map((ratingCount) => [
				ratingCount.rating,
				ratingCount._count.rating,
			]),
		),
		reviews,
	});
}

async function findBookings(user: AuthUser, query: HostBookingListQuery) {
	ensureHost(user);

	const { skip, take } = getPagination(query);
	const { orderBy } = getSorting(query.sort, query.order, {
		defaultField: DEFAULT_BOOKING_SORT_FIELD,
		defaultOrder: DEFAULT_BOOKING_SORT_ORDER,
	});

	const [bookings, total] = await Promise.all([
		hostRepository.findBookings(
			user.id,
			{
				status: query.status,
			},
			{
				skip,
				take,
				orderBy,
			},
		),
		hostRepository.countBookings(user.id, {
			status: query.status,
		}),
	]);

	return {
		data: bookings.map(toHostBooking),
		meta: createPaginationMeta({
			page: query.page,
			limit: query.limit,
			total,
		}),
	};
}

async function updateBookingStatus(
	user: AuthUser,
	id: string,
	input: UpdateHostBookingStatus,
) {
	ensureHost(user);

	const booking = await hostRepository.findBookingById(user.id, id);

	if (!booking) {
		throw new NotFoundError("Booking not found.");
	}

	assertAllowedBookingTransition(booking.status, input.status);

	if (
		input.status === BookingStatus.completed &&
		getTodayUtc() < booking.endDate
	) {
		throw new BadRequestError(
			"Booking cannot be completed before its end date.",
		);
	}

	if (input.status === BookingStatus.confirmed) {
		const overlappingBooking = await hostRepository.findConfirmedOverlap(
			booking.vanId,
			booking.startDate,
			booking.endDate,
			booking.id,
		);

		if (overlappingBooking) {
			throw new ConflictError(
				"Confirming this booking would conflict with another confirmed booking.",
			);
		}
	}

	const updatedBooking = await hostRepository.updateBookingStatus(
		booking.id,
		input.status,
	);

	return toHostBooking(updatedBooking);
}

export const hostService = {
	findVans,
	findVanById,
	createVan,
	updateVan,
	deleteVan,
	getDashboard,
	getIncome,
	getReviews,
	findBookings,
	updateBookingStatus,
};
