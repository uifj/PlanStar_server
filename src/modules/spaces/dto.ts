import type { Space, SpaceMember } from "../../generated/prisma/client.js";

type SpaceWithMembership = Space & { members: SpaceMember[] };

export function toSpace(space: SpaceWithMembership) {
	return {
		id: space.id,
		name: space.name,
		status: space.status,
		permission: space.members[0].permission,
		createdAt: space.createdAt.toISOString(),
		updatedAt: space.updatedAt.toISOString(),
	};
}

export function toSpaceParticipant(member: SpaceMember) {
	return {
		id: member.id,
		spaceId: member.spaceId,
		userId: member.userId,
		permission: member.permission,
		status: member.status,
		createdAt: member.createdAt.toISOString(),
	};
}
