import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

const includeRelations = { relations: true } satisfies Prisma.ObjectTypeInclude;

async function findMany(
	spaceId: string,
	where: Prisma.ObjectTypeWhereInput,
	options: {
		skip: number;
		take: number;
		orderBy: Prisma.ObjectTypeOrderByWithRelationInput;
	},
) {
	return prisma.objectType.findMany({
		where: { ...where, spaceId },
		include: includeRelations,
		orderBy: options.orderBy,
		skip: options.skip,
		take: options.take,
	});
}

async function count(spaceId: string, where: Prisma.ObjectTypeWhereInput) {
	return prisma.objectType.count({ where: { ...where, spaceId } });
}

async function findByUniqueKey(spaceId: string, uniqueKey: string) {
	return prisma.objectType.findFirst({ where: { spaceId, uniqueKey } });
}

async function create(data: Prisma.ObjectTypeUncheckedCreateInput) {
	return prisma.objectType.create({ data });
}

// ADR-0005: the registry projects a read-only mirror row into Obj.
async function upsertMirror(input: {
	id: string;
	spaceId: string;
	creatorId: string;
	name: string;
	description: string | null;
	iconEmoji: string | null;
	details: Prisma.InputJsonValue;
}) {
	return prisma.obj.upsert({
		where: { id: input.id },
		create: {
			id: input.id,
			spaceId: input.spaceId,
			layout: "objectType",
			resolvedLayout: "objectType",
			name: input.name,
			description: input.description,
			iconEmoji: input.iconEmoji,
			creatorId: input.creatorId,
			isHidden: true,
			details: input.details,
		},
		update: {
			name: input.name,
			description: input.description,
			iconEmoji: input.iconEmoji,
			details: input.details,
		},
	});
}

export const objectTypeRepository = {
	findMany,
	count,
	findByUniqueKey,
	create,
	upsertMirror,
};
