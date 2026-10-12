import type { RenterBookingsQueryParams } from "./types";

export const bookingQueryKeys = {
	all: ["bookings"] as const,
	list: (params: RenterBookingsQueryParams = {}) =>
		[...bookingQueryKeys.all, params] as const,
};
