import type { Prisma } from "../../generated/prisma/client.js";
import { ACTIVE_BOOKING_STATUSES } from "./constants.js";
import type { BookingListQuery } from "./schema.js";

export function buildWhere(
	userId: string,
	query: Pick<BookingListQuery, "status">,
): Prisma.BookingWhereInput {
	return {
		userId,
		status: query.status,
	};
}

// One predicate for "these dates are already spoken for", shared by the advisory
// read and by the write that enforces it, so the two can never disagree.
export function buildOverlapWhere(
	vanId: string,
	startDate: Date,
	endDate: Date,
): Prisma.BookingWhereInput {
	return {
		vanId,
		status: {
			in: ACTIVE_BOOKING_STATUSES,
		},
		startDate: {
			lt: endDate,
		},
		endDate: {
			gt: startDate,
		},
	};
}
