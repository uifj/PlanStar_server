import { ForbiddenError, NotFoundError } from "../errors/http-errors.js";
import { prisma } from "../lib/prisma.js";

export const PERMISSION_RANK = {
	reader: 10,
	writer: 20,
	admin: 30,
	owner: 40,
} as const;

export type SpacePermissionLevel = keyof typeof PERMISSION_RANK;

export async function ensureSpaceAccess(
	userId: string,
	spaceId: string,
	minimum: SpacePermissionLevel,
) {
	const member = await prisma.spaceMember.findFirst({
		where: { spaceId, userId, status: "active" },
	});

	if (member) {
		if (PERMISSION_RANK[member.permission] < PERMISSION_RANK[minimum]) {
			throw new ForbiddenError();
		}

		return member;
	}

	const spaceExists = await prisma.space.count({ where: { id: spaceId } });

	if (spaceExists === 0) {
		throw new NotFoundError("Space not found.");
	}

	throw new ForbiddenError();
}
