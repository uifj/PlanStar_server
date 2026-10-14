import { isUser } from "../../auth/roles.js";
import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	NotFoundError,
} from "../../errors/http-errors.js";
import { BookingStatus, type Van } from "../../generated/prisma/client.js";
import type { AuthUser } from "../../lib/auth.js";
import {
	createPaginationMeta,
	getPagination,
	getSorting,
} from "../../pagination/index.js";
import { vanLifeService } from "../vanlife/service.js";
import {
	DEFAULT_BOOKING_SORT_FIELD,
	DEFAULT_BOOKING_SORT_ORDER,
} from "./constants.js";
import { toBooking, toBookingListItem } from "./dto.js";
import { bookingRepository } from "./repository.js";
import type { BookingListQuery, CreateBooking } from "./schema.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateOnly(value: string) {
	return new Date(`${value}T00:00:00.000Z`);
}

function getTodayUtc() {
	const now = new Date();

	return new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
}

function getNightCount(startDate: Date, endDate: Date) {
	return Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY);
}

function validateBookingInput(input: CreateBooking, van: Van) {
	const startDate = parseDateOnly(input.startDate);
	const endDate = parseDateOnly(input.endDate);
	const today = getTodayUtc();

	if (startDate < today) {
		throw new BadRequestError("Start date must be today or later.");
	}

	if (endDate <= startDate) {
		throw new BadRequestError("End date must be after start date.");
	}

	if (input.guests > van.sleeps) {
		throw new BadRequestError("Guests cannot exceed van capacity.");
	}

	return {
		startDate,
		endDate,
		nights: getNightCount(startDate, endDate),
	};
}

function ensureRenter(user: AuthUser) {
	if (!isUser(user)) {
		throw new ForbiddenError("You need a renter account to do this.");
	}
}

function ensureCancellableStatus(status: BookingStatus) {
	if (status !== BookingStatus.pending && status !== BookingStatus.confirmed) {
		throw new BadRequestError("Booking cannot be cancelled.");
	}
}

async function findMany(user: AuthUser, query: BookingListQuery) {
	ensureRenter(user);

	const { skip, take } = getPagination(query);
	const { orderBy } = getSorting(query.sort, query.order, {
		defaultField: DEFAULT_BOOKING_SORT_FIELD,
		defaultOrder: DEFAULT_BOOKING_SORT_ORDER,
	});

	const [bookings, total] = await Promise.all([
		bookingRepository.findManyByUser(
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
		bookingRepository.countByUser(user.id, {
			status: query.status,
		}),
	]);

	return {
		data: bookings.map(toBookingListItem),
		meta: createPaginationMeta({
			page: query.page,
			limit: query.limit,
			total,
		}),
	};
}

async function create(user: AuthUser, input: CreateBooking) {
	ensureRenter(user);

	const van = await bookingRepository.findBookableVanById(input.vanId);

	if (!van) {
		throw new NotFoundError("Van not found.");
	}

	const { startDate, endDate, nights } = validateBookingInput(input, van);

	const result = await bookingRepository.createPendingIfAvailable({
		userId: user.id,
		van,
		startDate,
		endDate,
		guests: input.guests,
		totalPrice: nights * van.price,
	});

	if (result.status === "van_unavailable") {
		throw new NotFoundError("Van not found.");
	}

	if (result.status === "overlap") {
		throw new ConflictError("Requested dates overlap an existing booking.");
	}

	await vanLifeService.mirrorBooking(user, result.booking.id);

	return toBooking(result.booking);
}

async function cancel(user: AuthUser, id: string) {
	ensureRenter(user);

	const booking = await bookingRepository.findOwnedById(user.id, id);

	if (!booking) {
		throw new NotFoundError("Booking not found.");
	}

	ensureCancellableStatus(booking.status);

	const updatedBooking = await bookingRepository.updateOwnedStatus(
		user.id,
		id,
		BookingStatus.cancelled,
	);

	await vanLifeService.mirrorBooking(user, updatedBooking.id);

	return toBooking(updatedBooking);
}

export const bookingService = {
	findMany,
	create,
	cancel,
};
