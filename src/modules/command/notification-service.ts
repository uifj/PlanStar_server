import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

// Anytype I.NotificationStatus (interface/notification.ts:16): Created 0, Shown 1, Read 2, Replied 3.
// A row is "unread" until it reaches Read; NotificationReply(Close) moves it to Replied so it drops
// off the includeRead=false list the client boots with (data.ts:496).
const STATUS_CREATED = 0;
const STATUS_READ = 2;
const STATUS_REPLIED = 3;

// The wire shape From.Notification reads (mapper.ts:536): the type-named field carries the payload,
// and NotificationPayload (mapper.ts:94) derives the type from which field is present. So a stored row
// projects to { id, createTime, status, isLocal, [type]: payload }.
export interface NotificationWire {
	id: string;
	createTime: number;
	status: number;
	isLocal: boolean;
	[typeField: string]: unknown;
}

function notificationRecord(row: {
	id: string;
	type: string;
	status: number;
	isLocal: boolean;
	createTime: bigint;
	payload: Prisma.JsonValue;
}): NotificationWire {
	return {
		id: row.id,
		createTime: Number(row.createTime),
		status: row.status,
		isLocal: row.isLocal,
		[row.type]: row.payload,
	};
}

// NotificationList { includeRead, limit } (command.ts:1790): the caller's own notifications,
// newest-first, capped at limit. includeRead=false (the boot fetch) filters to status < Read.
export async function listNotifications(
	userId: string,
	includeRead: boolean,
	limit: number,
): Promise<NotificationWire[]> {
	const rows = await prisma.notification.findMany({
		where: {
			userId,
			...(includeRead ? {} : { status: { lt: STATUS_READ } }),
		},
		orderBy: { createTime: "desc" },
		take: limit > 0 ? limit : undefined,
	});

	return rows.map(notificationRecord);
}

// NotificationReply { ids, actionType } (command.ts:1797): Close is the only action the client sends,
// and it marks the caller's notifications Replied so they leave the unread list. Scoped to userId so a
// caller can never reply to someone else's notification; unknown or foreign ids simply match nothing.
export async function replyNotifications(
	userId: string,
	ids: string[],
): Promise<void> {
	if (ids.length === 0) {
		return;
	}

	await prisma.notification.updateMany({
		where: { userId, id: { in: ids } },
		data: { status: STATUS_REPLIED },
	});
}

// Generation. A row is written at Created (unread) and its `type` is the wire field name the client
// derives the notification kind from (mapper.ts:94), so the payload stored here is projected back under
// that same field on read. The five member flows each own one generator below.

// SpacePermission string -> Anytype's numeric ParticipantPermissions, the value the client renders via
// translate('participantPermissions' + permissions). Inverse of registry-service's PARTICIPANT_PERMISSIONS.
const PERMISSION_TO_WIRE: Record<string, number> = {
	reader: 0,
	writer: 1,
	owner: 2,
	admin: 4,
};

// The id the participant subscription projects (registry-service participantId): the client addresses
// people by it, so a notification that names a person uses it too.
function participantId(spaceId: string, userId: string): string {
	return `_participant_${spaceId.replace(/\./g, "_")}_${userId}`;
}

async function spaceName(spaceId: string): Promise<string> {
	const space = await prisma.space.findUnique({
		where: { id: spaceId },
		select: { name: true },
	});
	return space?.name ?? "";
}

// createTime is unix seconds to match the wire number From.Notification reads; payload is stored verbatim.
async function createNotification(
	spaceId: string,
	userId: string,
	type: string,
	payload: Record<string, unknown>,
): Promise<void> {
	await prisma.notification.create({
		data: {
			spaceId,
			userId,
			type,
			status: STATUS_CREATED,
			isLocal: false,
			createTime: BigInt(Math.floor(Date.now() / 1000)),
			payload: payload as Prisma.InputJsonObject,
		},
	});
}

// A WithApprove join request lands in the Request tab, which only the space's active owners can act on,
// so each owner is told who asked to join. The requester's name/icon ride along for the display text
// sprintf(identityName, spaceName).
export async function notifyJoinRequest(
	spaceId: string,
	requesterId: string,
): Promise<void> {
	const [name, requester, owners] = await Promise.all([
		spaceName(spaceId),
		prisma.user.findUnique({
			where: { id: requesterId },
			select: { name: true, image: true },
		}),
		prisma.spaceMember.findMany({
			where: { spaceId, permission: "owner", status: "active" },
			select: { userId: true },
		}),
	]);

	const payload = {
		spaceId,
		spaceName: name,
		identity: participantId(spaceId, requesterId),
		identityName: requester?.name ?? "",
		identityIcon: requester?.image ?? "",
	};

	for (const owner of owners) {
		await createNotification(spaceId, owner.userId, "requestToJoin", payload);
	}
}

// Approve tells the requester they are in, at the role the moderator picked. Display is
// sprintf(spaceName, permissions), so permissions must be the wire number, not the stored string.
export async function notifyRequestApproved(
	spaceId: string,
	userId: string,
	permission: string,
): Promise<void> {
	const name = await spaceName(spaceId);
	await createNotification(spaceId, userId, "participantRequestApproved", {
		spaceId,
		spaceName: name,
		permissions: PERMISSION_TO_WIRE[permission] ?? 0,
	});
}

// Decline tells the requester the request was turned down. Display is sprintf(spaceName).
export async function notifyRequestDeclined(
	spaceId: string,
	userId: string,
): Promise<void> {
	const name = await spaceName(spaceId);
	await createNotification(spaceId, userId, "participantRequestDecline", {
		spaceId,
		spaceName: name,
	});
}

// A re-grade tells the affected member their new role. Display is sprintf(permissions, spaceName).
export async function notifyPermissionsChanged(
	spaceId: string,
	userId: string,
	permission: string,
): Promise<void> {
	const name = await spaceName(spaceId);
	await createNotification(spaceId, userId, "participantPermissionsChange", {
		spaceId,
		spaceName: name,
		permissions: PERMISSION_TO_WIRE[permission] ?? 0,
	});
}

// Removal tells each removed member they were let go. Display uses spaceName only, so the identity
// fields are vestigial but present to satisfy the payload type the client mapper reads.
export async function notifyParticipantsRemoved(
	spaceId: string,
	userIds: string[],
): Promise<void> {
	if (userIds.length === 0) {
		return;
	}

	const name = await spaceName(spaceId);
	for (const userId of userIds) {
		await createNotification(spaceId, userId, "participantRemove", {
			spaceId,
			spaceName: name,
			identity: participantId(spaceId, userId),
			identityName: "",
			identityIcon: "",
		});
	}
}
