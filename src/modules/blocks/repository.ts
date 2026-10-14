import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { BLOCK_LINK_RELATION } from "./constants.js";

async function findByDocument(objectId: string) {
	return prisma.block.findMany({
		where: { objectId },
		orderBy: { index: "asc" },
	});
}

async function findChildIndex(objectId: string, parentId: string | null) {
	const last = await prisma.block.findFirst({
		where: { objectId, parentId },
		orderBy: { index: "desc" },
		select: { index: true },
	});

	return last?.index ?? null;
}

async function findPlacement(objectId: string, blockId: string) {
	return prisma.block.findFirst({
		where: { id: blockId, objectId },
		select: { parentId: true, index: true },
	});
}

async function findNextIndex(
	objectId: string,
	parentId: string | null,
	afterIndex: string,
) {
	const next = await prisma.block.findFirst({
		where: { objectId, parentId, index: { gt: afterIndex } },
		orderBy: { index: "asc" },
		select: { index: true },
	});

	return next?.index ?? null;
}

async function findById(blockId: string) {
	return prisma.block.findUnique({ where: { id: blockId } });
}

async function update(id: string, data: Prisma.BlockUncheckedUpdateInput) {
	return prisma.block.update({ where: { id }, data });
}

async function create(data: Prisma.BlockUncheckedCreateInput) {
	return prisma.block.create({ data });
}

// A link block is the page's edge, not the block's (ADR-0013), so the page's
// links are recomputed from its own blocks after any write. Nesting cannot leave
// a stale edge behind, and repeated links to one target collapse to a single row.
async function syncEdges(spaceId: string, objectId: string) {
	const links = await prisma.block.findMany({
		where: { objectId, type: "link", linkTargetId: { not: null } },
		select: { linkTargetId: true, index: true },
		orderBy: { index: "asc" },
	});
	const targets = new Map<string, string>();

	for (const link of links) {
		if (link.linkTargetId && !targets.has(link.linkTargetId)) {
			targets.set(link.linkTargetId, link.index);
		}
	}

	await prisma.$transaction([
		prisma.link.deleteMany({
			where: { fromId: objectId, relationKey: BLOCK_LINK_RELATION },
		}),
		prisma.link.createMany({
			data: [...targets].map(([toId, sortOrder]) => ({
				spaceId,
				fromId: objectId,
				toId,
				relationKey: BLOCK_LINK_RELATION,
				sortOrder,
			})),
		}),
	]);
}

async function deleteById(id: string) {
	return prisma.block.delete({ where: { id } });
}

async function findIdsInSpace(spaceId: string, ids: string[]) {
	const rows = await prisma.obj.findMany({
		where: { spaceId, id: { in: ids } },
		select: { id: true },
	});

	return new Set(rows.map((row) => row.id));
}

export const blockRepository = {
	findByDocument,
	findChildIndex,
	findPlacement,
	findNextIndex,
	findById,
	update,
	create,
	deleteById,
	syncEdges,
	findIdsInSpace,
};
