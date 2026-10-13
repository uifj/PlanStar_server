import type { Prisma } from "../../generated/prisma/client.js";
import type { SpacePermission } from "../../generated/prisma/enums.js";
import { prisma } from "../../lib/prisma.js";

const memberInclude = (userId: string) =>
	({ members: { where: { userId } } }) satisfies Prisma.SpaceInclude;

async function create(name: string, userId: string) {
	return prisma.space.create({
		data: {
			name,
			createdBy: userId,
			members: {
				create: { userId, permission: "owner", status: "active" },
			},
		},
		include: memberInclude(userId),
	});
}

async function findManyForUser(
	userId: string,
	options: {
		skip: number;
		take: number;
		orderBy: Prisma.SpaceOrderByWithRelationInput;
	},
) {
	return prisma.space.findMany({
		where: {
			status: "active",
			members: { some: { userId, status: "active" } },
		},
		orderBy: options.orderBy,
		skip: options.skip,
		take: options.take,
		include: memberInclude(userId),
	});
}

async function countForUser(userId: string) {
	return prisma.space.count({
		where: {
			status: "active",
			members: { some: { userId, status: "active" } },
		},
	});
}

async function findUserById(userId: string) {
	return prisma.user.findUnique({
		where: { id: userId },
		select: { id: true },
	});
}

async function findMember(spaceId: string, userId: string) {
	return prisma.spaceMember.findFirst({ where: { spaceId, userId } });
}

async function findParticipantById(spaceId: string, participantId: string) {
	return prisma.spaceMember.findFirst({
		where: { id: participantId, spaceId },
	});
}

async function createMember(input: {
	spaceId: string;
	userId: string;
	permission: SpacePermission;
}) {
	return prisma.spaceMember.create({
		data: { ...input, status: "active" },
	});
}

async function updateMemberPermission(id: string, permission: SpacePermission) {
	return prisma.spaceMember.update({
		where: { id },
		data: { permission },
	});
}

export const spaceRepository = {
	create,
	findManyForUser,
	countForUser,
	findUserById,
	findMember,
	findParticipantById,
	createMember,
	updateMemberPermission,
};
