import { BookingStatus } from "../../generated/prisma/client.js";

export const BOOKING_STATUSES = [
	"pending",
	"confirmed",
	"completed",
	"cancelled",
] as const;

/** Bookings that still hold a van's dates. */
export const ACTIVE_BOOKING_STATUSES = [
	BookingStatus.pending,
	BookingStatus.confirmed,
];

export const BOOKING_SORT_FIELDS = [
	"startDate",
	"createdAt",
	"totalPrice",
] as const;

export const DEFAULT_BOOKING_SORT_FIELD = "createdAt";
export const DEFAULT_BOOKING_SORT_ORDER = "desc";
