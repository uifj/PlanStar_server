import type { Prisma } from "../../generated/prisma/client.js";
import type { VanListQuery } from "./schema.js";

export function buildWhere(
	query: Pick<VanListQuery, "search" | "type">,
): Prisma.VanWhereInput {
	const where: Prisma.VanWhereInput = {
		archivedAt: null,
	};

	if (query.type) {
		where.type = query.type;
	}

	if (query.search) {
		where.OR = [
			{ name: { contains: query.search, mode: "insensitive" } },
			{ location: { contains: query.search, mode: "insensitive" } },
			{ description: { contains: query.search, mode: "insensitive" } },
		];
	}

	return where;
}
