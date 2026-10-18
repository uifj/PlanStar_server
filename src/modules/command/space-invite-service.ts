import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { notifyJoinRequest } from "./notification-service.js";

// Anytype's numeric SpaceAccessType (interface/space.ts): Private 0, Shared 2. The share sheet flips
// a space to Shared before minting an invite and back to Private when sharing stops; the spaceView
// record projects it so the client derives isShared.
const SPACE_ACCESS_PRIVATE = 0;
const SPACE_ACCESS_SHARED = 2;

// An Anytype invite is an off-chain file addressed by a cid + fileKey pair. The self-hosted
// backend has no file network to publish to, so it mints two opaque random tokens and stores
// them on a SpaceInvite row; the pair is what the client pastes into a share link and what
// SpaceInviteView/SpaceJoin later resolve. base64url keeps them URL-safe without padding.
function randomToken(bytes = 24): string {
	return randomBytes(bytes).toString("base64url");
}

export interface GeneratedInvite {
	inviteCid: string;
	inviteFileKey: string;
	inviteType: number;
	permissions: number;
}

// Mint (or re-mint) the space's current invite. Anytype keeps one live invite per space: the
// share sheet reads it back with SpaceInviteGetCurrent and revokes it with SpaceInviteRevoke, so
// generating retires any prior non-revoked invite before inserting the new one. The numeric
// inviteType/permissions are echoed verbatim from the caller and stored as-is; SpaceJoin maps
// permissions back to a SpacePermission string when the invitee accepts.
export async function generateInvite(
	spaceId: string,
	createdBy: string,
	inviteType: number,
	permissions: number,
): Promise<GeneratedInvite> {
	await prisma.spaceInvite.updateMany({
		where: { spaceId, revoked: false },
		data: { revoked: true },
	});

	const inviteCid = randomToken();
	const inviteFileKey = randomToken();

	await prisma.spaceInvite.create({
		data: {
			spaceId,
			cid: inviteCid,
			fileKey: inviteFileKey,
			inviteType,
			permissions,
			createdBy,
		},
	});

	return { inviteCid, inviteFileKey, inviteType, permissions };
}

export interface CurrentInvite {
	inviteCid: string;
	inviteFileKey: string;
	inviteType: number;
	permissions: number;
}

// The space's single live invite, or an empty shape when none is outstanding (never generated, or
// revoked). SpaceInviteGetCurrent reads this to populate the share sheet; the client renders a link
// only when inviteCid is non-empty.
export async function getCurrentInvite(
	spaceId: string,
): Promise<CurrentInvite> {
	const row = await prisma.spaceInvite.findFirst({
		where: { spaceId, revoked: false },
		orderBy: { createdAt: "desc" },
	});

	if (!row) {
		return { inviteCid: "", inviteFileKey: "", inviteType: 0, permissions: 0 };
	}

	return {
		inviteCid: row.cid,
		inviteFileKey: row.fileKey,
		inviteType: row.inviteType,
		permissions: row.permissions,
	};
}

// Retire the live invite so its cid/key stops resolving in SpaceInviteView/SpaceJoin. Idempotent:
// revoking a space with no outstanding invite is a no-op success.
export async function revokeInvite(spaceId: string): Promise<void> {
	await prisma.spaceInvite.updateMany({
		where: { spaceId, revoked: false },
		data: { revoked: true },
	});
}

// Re-point the live invite's granted permissions without minting a new link, so a moderator can
// widen or narrow what the existing share URL admits. A space with no live invite has nothing to
// change; the update matches zero rows and succeeds.
export async function changeInvitePermissions(
	spaceId: string,
	permissions: number,
): Promise<void> {
	await prisma.spaceInvite.updateMany({
		where: { spaceId, revoked: false },
		data: { permissions },
	});
}

export interface InviteView {
	spaceId: string;
	spaceName: string;
	spaceIconCid: string;
	creatorName: string;
	creatorIconCid: string;
	inviteType: number;
	spaceIconOption: number;
	spaceType: number;
}

// Resolve a cid/key pair to the space's public preview. This is the invitee's first look at a
// space they are NOT yet a member of, so access is gated by possession of a live (non-revoked)
// invite rather than by membership. The self-hosted Space carries no icon, so the icon fields are
// honestly empty; the client falls back to the generated iconOption avatar.
export async function viewInvite(
	cid: string,
	fileKey: string,
): Promise<InviteView | null> {
	const invite = await prisma.spaceInvite.findFirst({
		where: { cid, fileKey, revoked: false },
		select: {
			inviteType: true,
			space: { select: { id: true, name: true, createdBy: true } },
		},
	});
	if (!invite) {
		return null;
	}

	const creator = await prisma.user.findUnique({
		where: { id: invite.space.createdBy },
		select: { name: true },
	});

	return {
		spaceId: invite.space.id,
		spaceName: invite.space.name,
		spaceIconCid: "",
		creatorName: creator?.name ?? "",
		creatorIconCid: "",
		inviteType: invite.inviteType,
		spaceIconOption: 0,
		spaceType: 0,
	};
}

// Anytype's numeric ParticipantPermissions -> the SpacePermission string a member row stores. An
// invite never grants owner (2), and None (3) is not a grant, so both fall through to reader; only
// Reader/Writer/Admin widen access.
const INVITE_PERMISSION_TO_SPACE: Record<
	number,
	"reader" | "writer" | "admin"
> = {
	0: "reader",
	1: "writer",
	4: "admin",
};

// Anytype's InviteType (interface/space.ts): WithApprove 0, Guest 1, WithoutApprove 2. Only a
// WithApprove invite gates entry behind a moderator's decision; the others admit the caller at once.
const INVITE_WITH_APPROVE = 0;

export interface JoinResult {
	spaceId: string;
}

// Enrol the caller in the space a live invite points at. Returns null when the cid/key is unknown
// or revoked (the caller must not be let in). A WithoutApprove/Guest invite makes them an active
// member straight away; a WithApprove invite only files a pending 'joining' request that surfaces in
// the members sheet's Request tab until SpaceRequestApprove/Decline resolves it. Upsert keeps
// joining idempotent and re-activates a previously removed member without escalating their stored
// permission, and an already-active member is never demoted back to a request.
export async function joinSpace(
	userId: string,
	cid: string,
	fileKey: string,
): Promise<JoinResult | null> {
	const invite = await prisma.spaceInvite.findFirst({
		where: { cid, fileKey, revoked: false },
		select: { spaceId: true, permissions: true, inviteType: true },
	});
	if (!invite) {
		return null;
	}

	const permission = INVITE_PERMISSION_TO_SPACE[invite.permissions] ?? "reader";
	const status =
		invite.inviteType === INVITE_WITH_APPROVE ? "joining" : "active";

	const existing = await prisma.spaceMember.findUnique({
		where: { spaceId_userId: { spaceId: invite.spaceId, userId } },
		select: { status: true },
	});
	if (existing?.status === "active") {
		return { spaceId: invite.spaceId };
	}

	await prisma.spaceMember.upsert({
		where: { spaceId_userId: { spaceId: invite.spaceId, userId } },
		create: {
			spaceId: invite.spaceId,
			userId,
			permission,
			status,
		},
		update: { status },
	});

	// Only a WithApprove invite files a request the owners must act on; a direct admit needs no notice.
	if (status === "joining") {
		await notifyJoinRequest(invite.spaceId, userId);
	}

	return { spaceId: invite.spaceId };
}

// Mark the space shareable so the client's isShared flips and the share sheet mints a link.
export async function makeSpaceShareable(spaceId: string): Promise<void> {
	await prisma.space.update({
		where: { id: spaceId },
		data: { spaceAccessType: SPACE_ACCESS_SHARED },
	});
}

// Stop sharing: return the space to Private and retire its live invite so the old link stops
// resolving. Both writes are scoped to the space; a space with no invite simply has nothing to
// revoke.
export async function stopSharing(spaceId: string): Promise<void> {
	await prisma.space.update({
		where: { id: spaceId },
		data: { spaceAccessType: SPACE_ACCESS_PRIVATE },
	});
	await revokeInvite(spaceId);
}
