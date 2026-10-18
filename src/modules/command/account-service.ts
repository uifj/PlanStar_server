import { PERMISSION_RANK } from "../../auth/space-access.js";
import { API_PREFIX } from "../../config/constants.js";
import { env } from "../../config/env.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuthUser } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { objectTypeService } from "../object-types/service.js";
import { relationService } from "../relations/service.js";

// The ObjectLayout migration is deferred, so the shell's system objects are real
// hidden Obj rows whose Anytype layout rides in details rather than in the enum.
const SYSTEM_OBJECTS = [
	{ layout: "profile", name: "Profile" },
	{ layout: "spaceView", name: "Space" },
	{ layout: "widgets", name: "Widgets" },
] as const;

type SystemLayout = (typeof SYSTEM_OBJECTS)[number]["layout"];

const DEFAULT_SPACE_NAME = "My Space";

// The types a fresh space installs for itself. The shell lists the space's type registry in
// its create menu and in the sidebar's Type section, so a space with no types answers "No
// Objects found" in both and gives the user no way to create an object as a type. These are
// the keys U.Data.getWidgetTypes treats as creatable.
const DEFAULT_TYPES = [
	{ uniqueKey: "ot-page", name: "Page" },
	{ uniqueKey: "ot-task", name: "Task" },
	{ uniqueKey: "ot-collection", name: "Collection" },
] as const;

// The relations a dataview column is resolved against, and the ones the default views reference.
const DEFAULT_RELATIONS = [
	{ uniqueKey: "name", name: "Name", format: "shortText" },
	{ uniqueKey: "done", name: "Done", format: "checkbox" },
	{ uniqueKey: "description", name: "Description", format: "longText" },
	{ uniqueKey: "createdDate", name: "Created", format: "date" },
	{ uniqueKey: "lastModifiedDate", name: "Last modified", format: "date" },
] as const;

// Anytype's numeric layout/status enums the vendored shell reads off a record.
const LAYOUT_SPACE_VIEW = 18;
const SPACE_ACCOUNT_STATUS_ACTIVE = 8;
const SPACE_LOCAL_STATUS_OK = 2;

export interface ResolvedAccount {
	spaceId: string;
	spaceName: string;
	createdDate: number;
	profileObjectId: string;
	spaceViewId: string;
	widgetsId: string;
	homepage: string;
	spaceOrder: string;
	spaceAccessType: number;
}

async function resolveSpace(user: AuthUser) {
	const existing = await prisma.space.findFirst({
		where: {
			status: "active",
			members: { some: { userId: user.id, status: "active" } },
		},
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			name: true,
			createdAt: true,
			spaceAccessType: true,
		},
	});

	const space = existing ?? (await createSpaceRow(user.id, DEFAULT_SPACE_NAME));

	return space;
}

type SpaceRow = {
	id: string;
	name: string;
	createdAt: Date;
	spaceAccessType: number;
};

async function createSpaceRow(userId: string, name: string): Promise<SpaceRow> {
	return prisma.space.create({
		data: {
			name,
			createdBy: userId,
			members: {
				create: { userId, permission: "owner", status: "active" },
			},
		},
		select: {
			id: true,
			name: true,
			createdAt: true,
			spaceAccessType: true,
		},
	});
}

type SystemObject = { id: string; details: Prisma.JsonValue };

async function ensureSystemObject(
	spaceId: string,
	layout: SystemLayout,
	name: string,
	creatorId: string,
): Promise<SystemObject> {
	const found = await prisma.obj.findFirst({
		where: {
			spaceId,
			isDeleted: false,
			details: { path: ["layout"], equals: layout },
		},
		select: { id: true, details: true },
	});

	if (found) {
		return found;
	}

	return prisma.obj.create({
		data: {
			spaceId,
			name,
			isHidden: true,
			creatorId,
			details: { layout },
		},
		select: { id: true, details: true },
	});
}

// The space's home object id — or a predefined marker like "widgets" — rides on the spaceView
// object's details, since Space has no homepage column (space.ts:217 reads space.homepage).
function homepageOf(details: Prisma.JsonValue): string {
	if (details && typeof details === "object" && !Array.isArray(details)) {
		const value = (details as Record<string, unknown>).homepage;
		if (typeof value === "string") {
			return value;
		}
	}
	return "";
}

// One provisioning path feeds every boot command: AccountSelect, WorkspaceOpen and
// the "space" subscription all describe the same real space and its system objects.
async function accountForSpace(
	space: SpaceRow,
	userId: string,
): Promise<ResolvedAccount> {
	const resolved = {} as Record<SystemLayout, SystemObject>;

	for (const system of SYSTEM_OBJECTS) {
		resolved[system.layout] = await ensureSystemObject(
			space.id,
			system.layout,
			system.name,
			userId,
		);
	}

	await installDefaultTypes(userId, space.id);
	await installDefaultRelations(userId, space.id);

	// The caller's personal pin/reorder position for this space rides on their membership row
	// (SpaceMember.orderId), not on the space's shared spaceView object, so two members of the
	// same space each keep their own vault arrangement. Empty when never ordered -> not pinned.
	const member = await prisma.spaceMember.findFirst({
		where: { spaceId: space.id, userId },
		select: { orderId: true },
	});

	return {
		spaceId: space.id,
		spaceName: space.name,
		createdDate: Math.floor(space.createdAt.getTime() / 1000),
		profileObjectId: resolved.profile.id,
		spaceViewId: resolved.spaceView.id,
		widgetsId: resolved.widgets.id,
		homepage: homepageOf(resolved.spaceView.details),
		spaceOrder: member?.orderId ?? "",
		spaceAccessType: space.spaceAccessType,
	};
}

export async function ensureAccount(user: AuthUser): Promise<ResolvedAccount> {
	const space = await resolveSpace(user);
	return accountForSpace(space, user.id);
}

// WorkspaceOpen(spaceId): resolve and provision a specific space the caller has
// already been granted access to. Returns null when the space row is gone.
export async function accountForSpaceId(
	spaceId: string,
	userId: string,
): Promise<ResolvedAccount | null> {
	const space = await prisma.space.findUnique({
		where: { id: spaceId },
		select: {
			id: true,
			name: true,
			createdAt: true,
			spaceAccessType: true,
		},
	});
	if (!space) {
		return null;
	}
	return accountForSpace(space, userId);
}

// WorkspaceCreate: a brand-new Space owned by the caller, provisioned with the same
// system objects so it boots exactly like the primary space.
export async function createSpace(
	user: AuthUser,
	name: string,
): Promise<ResolvedAccount> {
	const space = await createSpaceRow(user.id, name || DEFAULT_SPACE_NAME);
	return accountForSpace(space, user.id);
}

// objectTypeService.create also mirrors the type into Obj, so the space gets the same rows a
// later ObjectCreateObjectType would. Existing keys are skipped rather than raised over, so a
// space re-opened after a partial install stays usable. A reader cannot extend the registry,
// so their boot leaves the space exactly as its owner installed it instead of failing.
async function installDefaultTypes(userId: string, spaceId: string) {
	if (!(await canExtendRegistry(userId, spaceId))) {
		return;
	}

	const installed = await prisma.objectType.findMany({
		where: {
			spaceId,
			uniqueKey: { in: DEFAULT_TYPES.map((it) => it.uniqueKey) },
		},
		select: { uniqueKey: true },
	});
	const present = new Set(installed.map((it) => it.uniqueKey));

	for (const type of DEFAULT_TYPES) {
		if (present.has(type.uniqueKey)) {
			continue;
		}

		await objectTypeService.create({ id: userId }, spaceId, {
			uniqueKey: type.uniqueKey,
			name: type.name,
		});
	}
}

// The relations a view's columns are resolved against: the shell looks each key up in the space's
// `relation-<spaceId>` store to read a column's format and options (lib/dataview.ts:15-60), so a
// space with no relation rows draws a grid whose cells are all empty. These are the ones the
// default types' own views and the type sidebar reference.
async function installDefaultRelations(userId: string, spaceId: string) {
	if (!(await canExtendRegistry(userId, spaceId))) {
		return;
	}

	const installed = await prisma.relation.findMany({
		where: {
			spaceId,
			uniqueKey: { in: DEFAULT_RELATIONS.map((it) => it.uniqueKey) },
		},
		select: { uniqueKey: true },
	});
	const present = new Set(installed.map((it) => it.uniqueKey));

	for (const relation of DEFAULT_RELATIONS) {
		if (present.has(relation.uniqueKey)) {
			continue;
		}

		await relationService.create({ id: userId }, spaceId, {
			uniqueKey: relation.uniqueKey,
			name: relation.name,
			format: relation.format,
		});
	}
}

// Both installers run on the boot path, where the caller may only hold a reader grant.
async function canExtendRegistry(userId: string, spaceId: string) {
	const member = await prisma.spaceMember.findFirst({
		where: { spaceId, userId, status: "active" },
		select: { permission: true },
	});
	return (
		!!member && PERMISSION_RANK[member.permission] >= PERMISSION_RANK.writer
	);
}

// Every active space the caller belongs to, oldest first — the source for the global
// "space" subscription the vault lists and switchSpace picks from.
export async function listAccounts(user: AuthUser): Promise<ResolvedAccount[]> {
	const spaces = await prisma.space.findMany({
		where: {
			status: "active",
			members: { some: { userId: user.id, status: "active" } },
		},
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			name: true,
			createdAt: true,
			spaceAccessType: true,
		},
	});

	const accounts: ResolvedAccount[] = [];
	for (const space of spaces) {
		accounts.push(await accountForSpace(space, user.id));
	}
	return accounts;
}

// WorkspaceSetInfo: apply the editable space details. Only the name is modeled on
// the Space row today; icon/access-type have no columns yet, so they are accepted but
// not persisted rather than silently dropped into a fabricated field. The homepage is
// set by its own command (see setSpaceHomepage below).
export async function renameSpace(spaceId: string, name: string) {
	await prisma.space.update({ where: { id: spaceId }, data: { name } });
}

// WorkspaceSetHomepage: persist the space's home object id — or a predefined marker like
// "widgets" that is not a real object — on the spaceView object's details, where the "space"
// subscription reads it back (spaceViewRecord projects account.homepage). Marker strings are
// stored verbatim; no object of that id need exist. A missing spaceView row is a no-op.
export async function setSpaceHomepage(spaceViewId: string, homepage: string) {
	const spaceView = await prisma.obj.findUnique({
		where: { id: spaceViewId },
		select: { details: true },
	});
	if (!spaceView) {
		return;
	}

	const details: Record<string, unknown> =
		spaceView.details &&
		typeof spaceView.details === "object" &&
		!Array.isArray(spaceView.details)
			? { ...(spaceView.details as Record<string, unknown>) }
			: {};
	details.homepage = homepage;

	await prisma.obj.update({
		where: { id: spaceViewId },
		data: { details: details as Prisma.InputJsonObject },
	});
}

// Width of the zero-padded decimal order key, matching setTypeOrder so keys assigned by
// separate SpaceSetOrder calls stay lexicographically comparable (the client's sortByOrderId
// is a plain string compare, and an empty key — a space never pinned — sorts last / unpinned).
const SPACE_ORDER_WIDTH = 6;

// SpaceSetOrder: persist the caller's vault pin/reorder. The client sends the full ordered list
// of pinned spaceView object ids (vault.tsx:198 drag, menu.ts:881 pin). Each id takes a strictly
// increasing key by position, written to the caller's SpaceMember row for the space that
// spaceView represents — so the arrangement is personal and survives a reload via the space
// subscription's spaceOrder. updateMany is scoped to { spaceId, userId }, so an id that is not a
// spaceView the caller belongs to matches nothing and a stale or foreign list can never reorder
// another space or another member's rail. Returns the keys positionally to echo back as the
// response's spaceViewOrder, which the client writes onto each record as its orderId.
export async function setSpaceOrder(userId: string, spaceViewIds: string[]) {
	const orderIds = spaceViewIds.map((_, index) =>
		String(index).padStart(SPACE_ORDER_WIDTH, "0"),
	);

	const views = await prisma.obj.findMany({
		where: { id: { in: spaceViewIds } },
		select: { id: true, spaceId: true },
	});
	const spaceIdByView = new Map(views.map((view) => [view.id, view.spaceId]));

	await prisma.$transaction(
		spaceViewIds.flatMap((viewId, index) => {
			const spaceId = spaceIdByView.get(viewId);
			if (!spaceId) {
				return [];
			}
			return [
				prisma.spaceMember.updateMany({
					where: { spaceId, userId },
					data: { orderId: orderIds[index] },
				}),
			];
		}),
	);

	return orderIds;
}

// SpaceUnsetOrder: the vault's "unpin" (menu.ts:889) drops a single space from the caller's rail
// by clearing its order key, leaving every other pinned space's key — and thus the rest of the
// order — untouched. The empty key is what getVaultItems reads as isPinned = false. Like
// setSpaceOrder the write is scoped to { spaceId, userId }, so unsetting a spaceView the caller
// does not belong to matches no row and can never unpin another member's space.
export async function unsetSpaceOrder(userId: string, spaceViewId: string) {
	const view = await prisma.obj.findFirst({
		where: { id: spaceViewId },
		select: { spaceId: true },
	});
	if (!view) {
		return;
	}

	await prisma.spaceMember.updateMany({
		where: { spaceId: view.spaceId, userId },
		data: { orderId: "" },
	});
}

// SpaceDelete: Anytype collapses "leave" and "delete" into one command. The owner
// deletes the whole space (children cascade); any other member only drops their own
// membership, leaving the space intact for the rest.
export async function leaveOrDeleteSpace(userId: string, spaceId: string) {
	const member = await prisma.spaceMember.findFirst({
		where: { spaceId, userId },
		select: { permission: true },
	});

	if (member?.permission === "owner") {
		await prisma.space.delete({ where: { id: spaceId } });
		return;
	}

	await prisma.spaceMember.deleteMany({ where: { spaceId, userId } });
}

// The AccountInfo shape Mapper.From.AccountInfo reads (mapper.ts:131-146). The web
// build has no analytics, network or ethereum identity yet, so those stay empty rather
// than fabricated; the object ids are all real rows. gatewayUrl is the API base the file
// serve routes are mounted under, so the client's fileUrl/imageUrl (store/common.ts) build
// `<gateway>/file/<id>` that lands on GET /api/file/:id.
export function accountInfo(account: ResolvedAccount, userId: string) {
	return {
		profileObjectId: account.profileObjectId,
		gatewayUrl: `${env.APP_URL}${API_PREFIX}`,
		deviceId: userId,
		accountSpaceId: account.spaceId,
		techSpaceId: account.spaceId,
		spaceViewId: account.spaceViewId,
		widgetsId: account.widgetsId,
		analyticsId: "",
		networkId: "",
		workspaceObjectId: account.spaceViewId,
		ethereumAddress: "",
		metaDataKey: "",
	};
}

// The spaceview record the global "space" subscription must return for the shell to
// consider the space auto-openable (U.Space.canAutoOpen). Field names follow the
// client's default + space + participant relation keys.
export function spaceViewRecord(account: ResolvedAccount, userId: string) {
	return {
		id: account.spaceViewId,
		spaceId: account.spaceId,
		targetSpaceId: account.spaceId,
		layout: LAYOUT_SPACE_VIEW,
		resolvedLayout: LAYOUT_SPACE_VIEW,
		name: account.spaceName,
		description: "",
		snippet: "",
		iconEmoji: "",
		iconImage: "",
		iconName: "",
		iconOption: 0,
		type: [],
		done: false,
		isArchived: false,
		isDeleted: false,
		isHidden: false,
		isReadonly: false,
		relationFormat: 0,
		fileExt: "",
		fileMimeType: "",
		sizeInBytes: 0,
		restrictions: {},
		defaultTemplateId: "",
		createdDate: account.createdDate,
		timestamp: account.createdDate,
		discussionId: "",
		homepage: account.homepage,
		spaceAccountStatus: SPACE_ACCOUNT_STATUS_ACTIVE,
		spaceLocalStatus: SPACE_LOCAL_STATUS_OK,
		spaceAccessType: account.spaceAccessType,
		readersLimit: 0,
		writersLimit: 0,
		creator: userId,
		chatId: "",
		spaceType: 0,
		spacePushNotificationMode: 0,
		spacePushNotificationForceAllIds: [],
		spacePushNotificationForceMuteIds: [],
		spacePushNotificationForceMentionIds: [],
		spaceOrder: account.spaceOrder,
		spaceJoinDate: 0,
		oneToOneIdentity: "",
		analyticsSpaceId: "",
		identity: "",
		participantPermissions: 0,
		participantStatus: 0,
		globalName: "",
		pluralName: "",
	};
}
