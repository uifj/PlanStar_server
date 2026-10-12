import type { Prisma } from "../../generated/prisma/client.js";
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
