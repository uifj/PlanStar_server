import { prisma } from "../../lib/prisma.js";
import {
	notifyParticipantsRemoved,
	notifyPermissionsChanged,
	notifyRequestApproved,
	notifyRequestDeclined,
} from "./notification-service.js";

// Anytype's numeric ParticipantPermissions -> the SpacePermission string a member row stores. An
// invite/direct-add never grants owner (2); None (3) is not a grant. Both fall through to reader,
// and ownership moves only through SpaceChangeOwnership.
const NUMERIC_TO_SPACE_PERMISSION: Record<
	number,
	"reader" | "writer" | "admin"
> = {
	0: "reader",
	1: "writer",
	4: "admin",
};

// Reverse of registry-service's participantId: `_participant_<spaceId with dots as _>_<userId>`.
// The client addresses people by this id, so member management decodes it back to a userId. An id
// that does not carry this space's prefix decodes to "" and is ignored.
function userIdFromParticipant(spaceId: string, identity: string): string {
	const prefix = `_participant_${spaceId.replace(/\./g, "_")}_`;
	return identity.startsWith(prefix) ? identity.slice(prefix.length) : "";
}

async function ownerUserIds(spaceId: string): Promise<Set<string>> {
	const owners = await prisma.spaceMember.findMany({
		where: { spaceId, permission: "owner" },
		select: { userId: true },
	});
	return new Set(owners.map((o) => o.userId));
}

// Enrol people directly (no invite link) from the members sheet. Upsert keeps it idempotent and
// re-activates a previously removed member; the update branch never touches permission, so an
// existing owner added by accident keeps their role.
export async function addParticipants(
	spaceId: string,
	identities: string[],
	permissions: number,
): Promise<void> {
	const permission = NUMERIC_TO_SPACE_PERMISSION[permissions] ?? "reader";
	const userIds = identities
		.map((identity) => userIdFromParticipant(spaceId, identity))
		.filter((userId) => userId.length > 0);

	for (const userId of userIds) {
		await prisma.spaceMember.upsert({
			where: { spaceId_userId: { spaceId, userId } },
			create: { spaceId, userId, permission, status: "active" },
			update: { status: "active" },
		});
	}
}

export interface PermissionChange {
	identity: string;
	perms: number;
}

// Re-grade existing members. The owner is skipped so a moderator cannot lock the owner out.
export async function changeParticipantPermissions(
	spaceId: string,
	changes: PermissionChange[],
): Promise<void> {
	const owners = await ownerUserIds(spaceId);

	for (const change of changes) {
		const userId = userIdFromParticipant(spaceId, change.identity);
		if (!userId || owners.has(userId)) {
			continue;
		}
		const permission = NUMERIC_TO_SPACE_PERMISSION[change.perms] ?? "reader";
		await prisma.spaceMember.updateMany({
			where: { spaceId, userId },
			data: { permission },
		});
		await notifyPermissionsChanged(spaceId, userId, permission);
	}
}

// Soft-remove members (status "removed", mirroring the participant subscription's removed state) so
// the space keeps an audit of who was there. The owner is never removed.
export async function removeParticipants(
	spaceId: string,
	identities: string[],
): Promise<void> {
	const owners = await ownerUserIds(spaceId);
	const userIds = identities
		.map((identity) => userIdFromParticipant(spaceId, identity))
		.filter((userId) => userId.length > 0 && !owners.has(userId));

	if (userIds.length === 0) {
		return;
	}

	await prisma.spaceMember.updateMany({
		where: { spaceId, userId: { in: userIds } },
		data: { status: "removed" },
	});
	await notifyParticipantsRemoved(spaceId, userIds);
}

// Transfer ownership: promote an existing active member to owner and demote the current owner to
// oldOwnerPermissions (Anytype sends Writer). Returns false when the target identity does not decode
// to an active member, so the command can answer NOT_FOUND without touching any row. Both writes
// land in one transaction so the space never has zero or two owners.
export async function changeOwnership(
	spaceId: string,
	newOwnerIdentity: string,
	oldOwnerUserId: string,
	oldOwnerPermissions: number,
): Promise<boolean> {
	const newOwnerUserId = userIdFromParticipant(spaceId, newOwnerIdentity);
	if (!newOwnerUserId) {
		return false;
	}

	const target = await prisma.spaceMember.findUnique({
		where: { spaceId_userId: { spaceId, userId: newOwnerUserId } },
	});
	if (!target || target.status !== "active") {
		return false;
	}

	const oldPermission =
		NUMERIC_TO_SPACE_PERMISSION[oldOwnerPermissions] ?? "writer";

	await prisma.$transaction([
		prisma.spaceMember.update({
			where: { spaceId_userId: { spaceId, userId: newOwnerUserId } },
			data: { permission: "owner" },
		}),
		prisma.spaceMember.update({
			where: { spaceId_userId: { spaceId, userId: oldOwnerUserId } },
			data: { permission: oldPermission },
		}),
	]);

	return true;
}

// Resolve a pending join request filed by a WithApprove invite: promote the 'joining' member to
// active at the role the moderator picked (which overrides the invited suggestion). Returns false
// when the identity does not decode to a joining request — unknown, or already active/removed — so
// the command answers NOT_FOUND without touching any row. A request never grants owner, so the
// mapped permission is capped at admin.
export async function approveRequest(
	spaceId: string,
	identity: string,
	permissions: number,
): Promise<boolean> {
	const userId = userIdFromParticipant(spaceId, identity);
	if (!userId) {
		return false;
	}

	const member = await prisma.spaceMember.findUnique({
		where: { spaceId_userId: { spaceId, userId } },
		select: { status: true },
	});
	if (!member || member.status !== "joining") {
		return false;
	}

	const permission = NUMERIC_TO_SPACE_PERMISSION[permissions] ?? "reader";
	await prisma.spaceMember.update({
		where: { spaceId_userId: { spaceId, userId } },
		data: { status: "active", permission },
	});

	await notifyRequestApproved(spaceId, userId, permission);

	return true;
}

// Withdraw a pending join request. The requester was never a member, so the 'joining' row is deleted
// outright rather than soft-removed — there is no past membership to keep an audit of, and the request
// simply leaves the Request tab. Returns false when the identity is not a live 'joining' request, so
// an active or removed member can never be touched through the decline path.
export async function declineRequest(
	spaceId: string,
	identity: string,
): Promise<boolean> {
	const userId = userIdFromParticipant(spaceId, identity);
	if (!userId) {
		return false;
	}

	const member = await prisma.spaceMember.findUnique({
		where: { spaceId_userId: { spaceId, userId } },
		select: { status: true },
	});
	if (!member || member.status !== "joining") {
		return false;
	}

	await prisma.spaceMember.delete({
		where: { spaceId_userId: { spaceId, userId } },
	});

	await notifyRequestDeclined(spaceId, userId);

	return true;
}
