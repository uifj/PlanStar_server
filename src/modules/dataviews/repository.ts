import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { DATAVIEW_LAYOUT, DATAVIEW_SOURCE_RELATION } from "./constants.js";

interface CreateViewInput {
	spaceId: string;
	creatorId: string;
	name: string;
	sourceTypeId: string;
	viewType: string;
	filters: Prisma.InputJsonValue;
	sorts: Prisma.InputJsonValue;
}

// ADR-0012: the view row and its source edge are written together.
async function create(input: CreateViewInput) {
	const id = crypto.randomUUID();

	await prisma.$transaction([
		prisma.obj.create({
			data: {
				id,
				spaceId: input.spaceId,
				layout: DATAVIEW_LAYOUT,
				resolvedLayout: DATAVIEW_LAYOUT,
				name: input.name,
				creatorId: input.creatorId,
				details: {
					viewType: input.viewType,
					dataviewFilters: input.filters,
					dataviewSorts: input.sorts,
				},
			},
		}),
		prisma.link.create({
			data: {
				spaceId: input.spaceId,
				fromId: id,
				toId: input.sourceTypeId,
				relationKey: DATAVIEW_SOURCE_RELATION,
				sortOrder: "0001",
			},
		}),
	]);

	return { id };
}

async function findView(spaceId: string, id: string) {
	return prisma.obj.findFirst({
		where: { id, spaceId, resolvedLayout: DATAVIEW_LAYOUT, isDeleted: false },
	});
}

async function findSourceTypeId(viewId: string) {
	const link = await prisma.link.findFirst({
		where: { fromId: viewId, relationKey: DATAVIEW_SOURCE_RELATION },
		select: { toId: true },
	});

	return link?.toId ?? null;
}

// Read-only registry lookup, the same way the objects module reads Relation keys.
async function findTypeInSpace(spaceId: string, typeId: string) {
	return prisma.objectType.findFirst({
		where: { id: typeId, spaceId },
		select: { id: true },
	});
}

export const dataviewRepository = {
	create,
	findView,
	findSourceTypeId,
	findTypeInSpace,
};

export type ViewRow = NonNullable<Awaited<ReturnType<typeof findView>>>;
