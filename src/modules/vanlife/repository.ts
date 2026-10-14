import type { Prisma, SpacePermission } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

type CopiedObject = {
	id: string;
	spaceId: string;
	typeId: string;
	name: string;
	description: string | null;
	creatorId: string;
	isArchived: boolean;
	createdAt: Date;
	details: Prisma.InputJsonValue;
};

async function findOrCreateSpace(id: string, name: string, createdBy: string) {
	const existing = await prisma.space.findUnique({
		where: { id },
		select: { id: true },
	});

	if (existing) {
		return existing;
	}

	return prisma.space.create({
		data: { id, name, createdBy },
		select: { id: true },
	});
}

async function findMembership(spaceId: string, userId: string) {
	return prisma.spaceMember.findUnique({
		where: { spaceId_userId: { spaceId, userId } },
		select: { permission: true },
	});
}

async function enrol(
	spaceId: string,
	userId: string,
	permission: SpacePermission,
) {
	return prisma.spaceMember.upsert({
		where: { spaceId_userId: { spaceId, userId } },
		create: { spaceId, userId, permission },
		update: { permission },
		select: { permission: true },
	});
}

async function findLegacyVans() {
	return prisma.van.findMany({ orderBy: { createdAt: "asc" } });
}

async function findLegacyBookings() {
	return prisma.booking.findMany({ orderBy: { createdAt: "asc" } });
}

async function findLegacyReviews() {
	return prisma.review.findMany({ orderBy: { createdAt: "asc" } });
}

async function findLegacyVanById(id: string) {
	return prisma.van.findUnique({ where: { id } });
}

async function findLegacyBookingById(id: string) {
	return prisma.booking.findUnique({ where: { id } });
}

async function findLegacyReviewById(id: string) {
	return prisma.review.findUnique({ where: { id } });
}

// A copied row keeps the legacy id, which is what lets the old routes answer for
// objects they never wrote.
async function upsertObject(object: CopiedObject) {
	return prisma.obj.upsert({
		where: { id: object.id },
		create: {
			id: object.id,
			spaceId: object.spaceId,
			typeId: object.typeId,
			name: object.name,
			description: object.description,
			creatorId: object.creatorId,
			isArchived: object.isArchived,
			createdAt: object.createdAt,
			details: object.details,
		},
		update: {
			typeId: object.typeId,
			name: object.name,
			description: object.description,
			creatorId: object.creatorId,
			isArchived: object.isArchived,
			details: object.details,
		},
	});
}

async function upsertEdge(edge: {
	spaceId: string;
	fromId: string;
	toId: string;
	relationKey: string;
}) {
	return prisma.link.upsert({
		where: {
			fromId_relationKey_toId: {
				fromId: edge.fromId,
				relationKey: edge.relationKey,
				toId: edge.toId,
			},
		},
		create: { ...edge, sortOrder: "0001" },
		update: {},
	});
}

export const vanLifeRepository = {
	findOrCreateSpace,
	findMembership,
	enrol,
	findLegacyVans,
	findLegacyBookings,
	findLegacyReviews,
	findLegacyVanById,
	findLegacyBookingById,
	findLegacyReviewById,
	upsertObject,
	upsertEdge,
};
