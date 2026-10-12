import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { buildWhere } from "./filters.js";
import type { VanListQuery } from "./schema.js";

async function findMany(
	query: Pick<VanListQuery, "search" | "type">,
	options: {
		skip: number;
		take: number;
		orderBy: Prisma.VanOrderByWithRelationInput;
	},
) {
	return prisma.van.findMany({
		where: buildWhere(query),
		orderBy: options.orderBy,
		skip: options.skip,
		take: options.take,
	});
}

async function count(query: Pick<VanListQuery, "search" | "type">) {
	return prisma.van.count({
		where: buildWhere(query),
	});
}

async function findPublicById(id: string) {
	return prisma.van.findFirst({
		where: {
			id,
			archivedAt: null,
		},
	});
}

export const vanRepository = {
	findMany,
	count,
	findPublicById,
};
