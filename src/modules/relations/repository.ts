import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

async function findMany(
	spaceId: string,
	where: Prisma.RelationWhereInput,
	options: {
		skip: number;
		take: number;
		orderBy: Prisma.RelationOrderByWithRelationInput;
	},
) {
	return prisma.relation.findMany({
		where: { ...where, spaceId },
		orderBy: options.orderBy,
		skip: options.skip,
		take: options.take,
	});
}

async function count(spaceId: string, where: Prisma.RelationWhereInput) {
	return prisma.relation.count({ where: { ...where, spaceId } });
}

async function findByUniqueKey(spaceId: string, uniqueKey: string) {
	return prisma.relation.findFirst({ where: { spaceId, uniqueKey } });
}

async function create(data: Prisma.RelationUncheckedCreateInput) {
	return prisma.relation.create({ data });
}

async function attachRelationsToType(
	spaceId: string,
	uniqueKeys: string[],
	typeId: string,
) {
	return prisma.relation.updateMany({
		where: { spaceId, uniqueKey: { in: uniqueKeys } },
		data: { typeId },
	});
}

// ADR-0005: the registry projects a read-only mirror row into Obj.
async function upsertMirror(input: {
	id: string;
	spaceId: string;
	creatorId: string;
	name: string;
	description: string | null;
	details: Prisma.InputJsonValue;
}) {
	return prisma.obj.upsert({
		where: { id: input.id },
		create: {
			id: input.id,
			spaceId: input.spaceId,
			layout: "relation",
			resolvedLayout: "relation",
			name: input.name,
			description: input.description,
			creatorId: input.creatorId,
			isHidden: true,
			details: input.details,
		},
		update: {
			name: input.name,
			description: input.description,
			details: input.details,
		},
	});
}

export const relationRepository = {
	findMany,
	count,
	findByUniqueKey,
	create,
	attachRelationsToType,
	upsertMirror,
};
