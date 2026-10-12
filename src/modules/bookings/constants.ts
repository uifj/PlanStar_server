export const BOOKING_STATUSES = [
	"pending",
	"confirmed",
	"completed",
	"cancelled",
] as const;

export const BOOKING_SORT_FIELDS = [
	"startDate",
	"createdAt",
	"totalPrice",
] as const;

export const DEFAULT_BOOKING_SORT_FIELD = "createdAt";
export const DEFAULT_BOOKING_SORT_ORDER = "desc";
