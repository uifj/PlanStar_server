import { randomUUID } from "node:crypto";
import { ensureSpaceAccess } from "../../auth/space-access.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuthUser } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { bodyLineId } from "../collab/projection.js";
import { objectTypeService } from "../object-types/service.js";
import type { CreateRelationInput } from "../relations/schema.js";
import { relationService } from "../relations/service.js";
import { ensureAccount } from "./account-service.js";
import { storeImageFile } from "./file-service.js";
import { fetchLinkPreview, fetchPreviewImage } from "./link-preview-service.js";
import {
	COLLECTION_RELATION,
	numericLayout,
	recommendedLayoutName,
} from "./registry-service.js";
import type { CommandBody } from "./schema.js";
import {
	DATAVIEW_BLOCK_ID,
	dataviewBlockFor,
	ensureSetViews,
} from "./set-view.js";

// I.ObjectLayout.Option === 13 (front_web interface/object.ts:15).
const LAYOUT_OPTION = 13;
// I.ObjectLayout.Set === 3 (front_web interface/object.ts); a set reads as a dataview.
const LAYOUT_SET = 3;
// I.ObjectLayout.Type === 4 (front_web interface/object.ts); a type opens as a set over its own objects.
const LAYOUT_TYPE = 4;
// I.ObjectLayout.Collection === 14; a collection opens at the same set screen, so it needs the same
// dataview child. Its rows are not a query source: the screen sends collectionId instead of a source.
const LAYOUT_COLLECTION = 14;
// Anytype timestamps are unix seconds; a date object is keyed to the start of its UTC day.
const SECONDS_PER_DAY = 86400;

// Client I.TextStyle numbers for the BlockStyle values the Prisma enum models.
const STYLE_TO_TEXT_STYLE: Record<string, number> = {
	paragraph: 0,
	heading1: 1,
	heading2: 2,
	heading3: 3,
	quote: 5,
	code: 6,
	bulleted: 9,
	numbered: 10,
	toggle: 11,
};

function detailsOf(body: CommandBody): Record<string, unknown> {
	const details = body.details;
	return details && typeof details === "object"
		? (details as Record<string, unknown>)
		: {};
}

// The client sends `type` as an array of type object ids (the `type` relation); Obj.typeId
// is a single FK to ObjectType, so the first id wins. Anything else leaves the object
// untyped rather than writing a value that would violate the relation.
// Keys the client sends in `details` that map onto real Obj columns rather than the
// details JSONB. Must stay in sync with the switch in setObjectDetails below.
const SYSTEM_DETAIL_KEYS = new Set([
	"name",
	"description",
	"snippet",
	"iconEmoji",
	"done",
	"isFavorite",
	"isArchived",
	"isHidden",
	"type",
]);

function typeIdOf(details: Record<string, unknown>): string | null {
	const raw = details.type;
	if (typeof raw === "string" && raw) {
		return raw;
	}
	if (Array.isArray(raw)) {
		const first = raw.find(
			(it): it is string => typeof it === "string" && it !== "",
		);
		return first ?? null;
	}
	return null;
}

// ObjectCreate names the chosen type by uniqueKey (`objectTypeUniqueKey`, command.ts:1174) rather
// than by id — the type rail's "new <Type>" and the template creator (typeKey ot-template) both rely
// on it. Resolve that key to the space's ObjectType id; an unknown key (or a fresh space whose
// default types were never seeded) resolves to nothing and falls back to any details.type ids, so the
// object stays untyped rather than failing. Mirrors setObjectType's space-scoped uniqueKey lookup.
async function resolveCreateTypeId(
	spaceId: string,
	body: CommandBody,
	details: Record<string, unknown>,
): Promise<string | null> {
	const key =
		typeof body.objectTypeUniqueKey === "string"
			? body.objectTypeUniqueKey
			: "";
	if (key) {
		const type = await prisma.objectType.findUnique({
			where: { spaceId_uniqueKey: { spaceId, uniqueKey: key } },
			select: { id: true },
		});
		if (type) {
			return type.id;
		}
	}
	return typeIdOf(details);
}

export async function createObject(user: AuthUser, body: CommandBody) {
	const account = await ensureAccount(user);
	const spaceId =
		typeof body.spaceId === "string" && body.spaceId
			? body.spaceId
			: account.spaceId;
	const details = detailsOf(body);
	const name = typeof details.name === "string" ? details.name : "";

	// Custom (non-column) relation values ride along in the details JSONB so a create
	// that carries them doesn't drop them; the layout marker is preserved on top.
	const persisted: Record<string, unknown> = { layout: "page" };
	for (const [key, value] of Object.entries(details)) {
		if (!SYSTEM_DETAIL_KEYS.has(key)) {
			persisted[key] = value;
		}
	}
	// Resolve the type before persisting so details.type and the typeId column agree — a read
	// projects the `type` relation from the column, so leaving details.type pointing at an
	// unresolved key would diverge from what setObjectType would later write.
	const typeId = await resolveCreateTypeId(spaceId, body, details);
	if (typeId) {
		persisted.type = [typeId];
	} else if (details.type !== undefined) {
		persisted.type = details.type;
	}

	return prisma.obj.create({
		data: {
			spaceId,
			name,
			typeId,
			// A type recommends a layout precisely so its objects render differently; taking it up
			// here is what makes a Task type produce tasks instead of pages to be repaired later.
			resolvedLayout: await inheritedLayout(typeId),
			details: persisted as Prisma.InputJsonObject,
			creatorId: user.id,
		},
	});
}

async function inheritedLayout(typeId: string | null) {
	if (!typeId) {
		return "basic" as const;
	}
	const type = await prisma.obj.findUnique({
		where: { id: typeId },
		select: { details: true },
	});
	const details = type?.details;
	const recommended =
		details && typeof details === "object" && !Array.isArray(details)
			? recommendedLayoutName(
					(details as Record<string, unknown>).recommendedLayout,
				)
			: null;
	return recommended ?? ("basic" as const);
}

/**
 * ObjectTypeResolveLayoutConflicts — the type page's "Reset to match the Type"
 * (page/elements/head/simple.tsx:248), whose own copy promises to reset "layout type, alignment, and
 * featured properties for all objects of this type". The layout is the part this server stores, so
 * that is the part it performs: every live object of the type that does not already carry the
 * recommended layout is rewritten to it. A type recommending nothing resets nothing, and a caller
 * without writer access throws for the command to answer FORBIDDEN.
 */
export async function resolveLayoutConflicts(
	user: AuthUser,
	body: CommandBody,
) {
	const typeObjectId =
		typeof body.typeObjectId === "string" ? body.typeObjectId : "";
	const type = await prisma.obj.findUnique({
		where: { id: typeObjectId },
		select: { spaceId: true, resolvedLayout: true, details: true },
	});
	if (!type) {
		return { status: "notFound" as const, objectIds: [] as string[] };
	}

	await ensureSpaceAccess(user.id, type.spaceId, "writer");

	if (numericLayout(type) !== LAYOUT_TYPE) {
		return { status: "notAType" as const, objectIds: [] as string[] };
	}

	const raw = type.details;
	const recommended =
		raw && typeof raw === "object" && !Array.isArray(raw)
			? recommendedLayoutName(
					(raw as Record<string, unknown>).recommendedLayout,
				)
			: null;
	if (!recommended) {
		return { status: "reset" as const, spaceId: type.spaceId, objectIds: [] };
	}

	const candidates = await prisma.obj.findMany({
		where: { spaceId: type.spaceId, typeId: typeObjectId, isArchived: false },
		select: { id: true, resolvedLayout: true },
	});
	const objectIds = candidates
		.filter((row) => row.resolvedLayout !== recommended)
		.map((row) => row.id);

	if (objectIds.length) {
		await prisma.obj.updateMany({
			where: { id: { in: objectIds } },
			data: { resolvedLayout: recommended },
		});
	}

	return { status: "reset" as const, spaceId: type.spaceId, objectIds };
}

// ObjectCreateSet mints a brand-new Set object (dataview.tsx:964, dataview/head.tsx:134,
// menu/block/action.tsx:556, page/main/relation.tsx:115). It leaves the same shape convertToSet
// produces — resolvedLayout "set" with the queried type ids on details.setOf — but as a fresh row
// rather than a flip of an existing one. The command carries spaceId directly, so writer access is
// checked here; a non-member cannot plant a set in someone else's space.
export async function createSetObject(
	user: AuthUser,
	body: CommandBody,
	sources: string[],
) {
	const account = await ensureAccount(user);
	const spaceId =
		typeof body.spaceId === "string" && body.spaceId
			? body.spaceId
			: account.spaceId;
	await ensureSpaceAccess(user.id, spaceId, "writer");

	const details = detailsOf(body);
	const name = typeof details.name === "string" ? details.name : "";

	// Custom relation values ride along in the details JSONB (as in createObject); the set
	// markers (layout + setOf) are laid down first so a colliding client key cannot drop them.
	const persisted: Record<string, unknown> = { layout: "set", setOf: sources };
	for (const [key, value] of Object.entries(details)) {
		if (!SYSTEM_DETAIL_KEYS.has(key)) {
			persisted[key] = value;
		}
	}
	if (details.type !== undefined) {
		persisted.type = details.type;
	}

	return prisma.obj.create({
		data: {
			spaceId,
			name,
			typeId: typeIdOf(details),
			resolvedLayout: "set",
			details: persisted as Prisma.InputJsonObject,
			creatorId: user.id,
		},
	});
}

// Downloads a bookmark's preview image (og:image -> picture, favicon -> iconImage) through the
// SSRF guard and stores it as a file object in the bookmark's space, returning its id, or "" when
// there is no url, the fetch is refused/fails, or the server declares a non-image content-type (so
// a 200 HTML error page is never stored as a cover). The client renders the id through the media
// gateway (imageUrl(id) -> GET /api/image/:id); a missing content-type is tolerated and resolved
// from the url extension inside storeImageFile.
async function storeBookmarkImage(
	spaceId: string,
	creatorId: string,
	imageUrl: string,
): Promise<string> {
	if (!imageUrl) {
		return "";
	}
	const image = await fetchPreviewImage(imageUrl);
	if (!image) {
		return "";
	}
	if (image.contentType && !image.contentType.startsWith("image/")) {
		return "";
	}
	return storeImageFile(spaceId, creatorId, {
		url: imageUrl,
		bytes: image.bytes,
		contentType: image.contentType,
	});
}

// ObjectCreateFromUrl mints a Bookmark object from a web url (menu/dataview/create/bookmark.tsx:53,
// lib/util/menu.ts:1536). It fetches the page through the SSRF-guarded preview fetch, lifts the
// title/description, and stores the url on the `source` relation. A refused url throws
// PreviewNotAllowedError (the command answers FORBIDDEN); an unparseable/non-HTML page yields a
// null preview, so the bookmark is still created with the url as its name — matching Anytype, where
// the card exists and shows an empty/error state. The bookmark type is resolved by uniqueKey within
// the space; an unknown key leaves the object untyped rather than failing the create.
export async function createObjectFromUrl(user: AuthUser, body: CommandBody) {
	const account = await ensureAccount(user);
	const spaceId =
		typeof body.spaceId === "string" && body.spaceId
			? body.spaceId
			: account.spaceId;
	await ensureSpaceAccess(user.id, spaceId, "writer");

	const details = detailsOf(body);
	// ObjectCreateFromUrl carries the url on `body.url`; ObjectCreateBookmark (the chat
	// composer's paste-a-link path) carries it on `details.source` instead. Both mint the same
	// bookmark, so the url is taken from whichever field the caller populated.
	const rawUrl = typeof body.url === "string" ? body.url : "";
	const sourceUrl = typeof details.source === "string" ? details.source : "";
	const url = (rawUrl || sourceUrl).trim();
	const preview = url ? await fetchLinkPreview(url) : null;

	const name =
		(preview?.title ?? "").trim() ||
		(typeof details.name === "string" ? details.name.trim() : "") ||
		url;
	const description =
		(preview?.description ?? "").trim() ||
		(typeof details.description === "string" ? details.description : "");

	const typeUniqueKey =
		typeof body.objectTypeUniqueKey === "string"
			? body.objectTypeUniqueKey
			: "";
	let typeId = typeIdOf(details);
	if (typeUniqueKey) {
		const type = await prisma.objectType.findUnique({
			where: { spaceId_uniqueKey: { spaceId, uniqueKey: typeUniqueKey } },
			select: { id: true },
		});
		if (type) {
			typeId = type.id;
		}
	}

	// Custom relation values ride along in the details JSONB (as in createObject); the bookmark
	// markers (layout + source) are laid down so a colliding client key cannot drop the url.
	const persisted: Record<string, unknown> = { layout: "bookmark" };
	for (const [key, value] of Object.entries(details)) {
		if (!SYSTEM_DETAIL_KEYS.has(key)) {
			persisted[key] = value;
		}
	}
	persisted.source = url;
	if (typeId) {
		persisted.type = [typeId];
	}

	// The cover and favicon are downloaded in parallel (each bounded by the preview timeout) and
	// stored as file objects, so picture/iconImage hold gateway-servable ids rather than raw
	// external urls the client's imageUrl(id) could not resolve. A refused, failed or non-image
	// fetch leaves the key unset and the bookmark still saves with its title/description/source.
	if (preview) {
		const [picture, iconImage] = await Promise.all([
			storeBookmarkImage(spaceId, user.id, preview.imageUrl),
			storeBookmarkImage(spaceId, user.id, preview.faviconUrl),
		]);
		if (picture) {
			persisted.picture = picture;
		}
		if (iconImage) {
			persisted.iconImage = iconImage;
		}
	}

	return prisma.obj.create({
		data: {
			spaceId,
			name,
			description: description || null,
			typeId,
			resolvedLayout: "bookmark",
			details: persisted as Prisma.InputJsonObject,
			creatorId: user.id,
		},
	});
}

// ObjectBookmarkFetch is the "reload source data" command for an existing bookmark
// (cell/index.tsx:372, menu/object.tsx:519, head/editor.tsx:175). It re-fetches the page through
// the SSRF-guarded preview fetch and refreshes the object's title/description plus its `source`
// relation. A refused url throws PreviewNotAllowedError (the command answers FORBIDDEN); a missing
// object returns null (NOT_FOUND). An unparseable page yields a null preview, so only `source` is
// updated and the existing title/description are kept rather than wiped.
export async function fetchBookmarkFor(
	user: AuthUser,
	contextId: string,
	url: string,
) {
	const obj = await prisma.obj.findUnique({
		where: { id: contextId },
		select: { id: true, spaceId: true, details: true, isDeleted: true },
	});
	if (!obj || obj.isDeleted) {
		return null;
	}

	await ensureSpaceAccess(user.id, obj.spaceId, "writer");

	const source = url.trim();
	const preview = source ? await fetchLinkPreview(source) : null;

	const details =
		obj.details &&
		typeof obj.details === "object" &&
		!Array.isArray(obj.details)
			? { ...(obj.details as Record<string, unknown>) }
			: {};
	details.source = source;

	// "Reload source data" refreshes the cover and favicon too: re-download them through the SSRF
	// guard and re-point picture/iconImage at fresh file objects. A refused/failed/non-image fetch
	// leaves any existing value untouched rather than wiping it, so a transient image error does not
	// strip a bookmark's cover.
	if (preview) {
		const [picture, iconImage] = await Promise.all([
			storeBookmarkImage(obj.spaceId, user.id, preview.imageUrl),
			storeBookmarkImage(obj.spaceId, user.id, preview.faviconUrl),
		]);
		if (picture) {
			details.picture = picture;
		}
		if (iconImage) {
			details.iconImage = iconImage;
		}
	}

	const title = (preview?.title ?? "").trim();
	const description = (preview?.description ?? "").trim();

	await prisma.obj.update({
		where: { id: obj.id },
		data: {
			details: details as Prisma.InputJsonObject,
			...(title ? { name: title } : {}),
			...(description ? { description } : {}),
		},
	});

	return obj.id;
}

// ObjectAddDiscussion mints the per-object comment chat (comment/section.tsx:619). A discussion is a
// separate object with the Discussion layout that the parent points at through its `discussionId`
// detail; comments are ordinary chat messages keyed by that id. The call is idempotent — an existing
// link is returned as-is — writer-gated, and null for a missing/deleted parent (the command answers
// NOT_FOUND). The discussion object is hidden so it stays out of "All objects"; the client reaches it
// only through the parent's discussionId (which objectRecord projects off the details JSONB).
export async function addDiscussion(user: AuthUser, objectId: string) {
	const parent = await prisma.obj.findUnique({
		where: { id: objectId },
		select: { id: true, spaceId: true, details: true, isDeleted: true },
	});
	if (!parent || parent.isDeleted) {
		return null;
	}

	await ensureSpaceAccess(user.id, parent.spaceId, "writer");

	const details =
		parent.details &&
		typeof parent.details === "object" &&
		!Array.isArray(parent.details)
			? { ...(parent.details as Record<string, unknown>) }
			: {};

	const existing = details.discussionId;
	if (typeof existing === "string" && existing) {
		return existing;
	}

	const discussion = await prisma.obj.create({
		data: {
			spaceId: parent.spaceId,
			name: "",
			typeId: null,
			resolvedLayout: "discussion",
			details: { layout: "discussion" } as Prisma.InputJsonObject,
			creatorId: user.id,
			isHidden: true,
		},
	});

	details.discussionId = discussion.id;
	await prisma.obj.update({
		where: { id: parent.id },
		data: { details: details as Prisma.InputJsonObject },
	});

	return discussion.id;
}
// first (the FK enforces it). Returns null when the target relation is missing so
// the command can answer NOT_FOUND instead of violating the constraint.
export async function createRelationOption(user: AuthUser, body: CommandBody) {
	const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
	await ensureSpaceAccess(user.id, spaceId, "writer");

	const details = detailsOf(body);
	const relationKey =
		typeof details.relationKey === "string" ? details.relationKey : "";
	const name = typeof details.name === "string" ? details.name : "";
	const color =
		typeof details.relationOptionColor === "string"
			? details.relationOptionColor
			: "";

	const relation = await prisma.relation.findUnique({
		where: { spaceId_uniqueKey: { spaceId, uniqueKey: relationKey } },
		select: { id: true },
	});
	if (!relation) {
		return null;
	}

	return prisma.relationOption.create({
		data: { spaceId, relationKey, name, color },
	});
}

// The detail object the client merges into its global option store after a create
// (optionSelect.tsx:453-456); it mirrors the option subscription record's keys.
export function relationOptionDetails(option: {
	id: string;
	name: string;
	relationKey: string;
	color: string;
}) {
	return {
		id: option.id,
		name: option.name,
		relationKey: option.relationKey,
		relationOptionColor: option.color,
		layout: LAYOUT_OPTION,
	};
}

// Delete select options by id. The command carries no spaceId, so each option's space is
// read off its row and the caller must be able to write every space touched; ensureSpaceAccess
// throws on the first space the caller cannot write, so a stale list can never delete across
// a boundary. Ids that match no option are simply absent from the delete set (an idempotent
// no-op), and the deleted ids are returned for the caller's log/response.
export async function removeRelationOptions(
	user: AuthUser,
	optionIds: string[],
) {
	if (optionIds.length === 0) {
		return [];
	}

	const options = await prisma.relationOption.findMany({
		where: { id: { in: optionIds } },
		select: { id: true, spaceId: true },
	});

	const spaceIds = [...new Set(options.map((option) => option.spaceId))];
	for (const spaceId of spaceIds) {
		await ensureSpaceAccess(user.id, spaceId, "writer");
	}

	const ids = options.map((option) => option.id);
	if (ids.length > 0) {
		await prisma.relationOption.deleteMany({ where: { id: { in: ids } } });
	}

	return ids;
}

// ObjectCreateObjectType / ObjectCreateRelation carry only a name (suggest.tsx:196,
// dataview/relation/edit.tsx:594); the registry keys a type/relation by a space-unique
// uniqueKey matching /^[a-z][a-zA-Z0-9]*$/, so mint one from the name plus a random suffix
// — two entries named the same must not collide.
function mintRegistryKey(name: string, fallback: string) {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "")
		.replace(/^[^a-z]+/, "")
		.slice(0, 24);
	const base = slug || fallback;
	return `${base}${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

// Anytype's numeric I.RelationType (front_web interface/object.ts) -> the Prisma
// RelationFormat enum. Only the formats the registry models are mapped; anything else
// (file/url/email/emoji, not yet backed by a column) falls back to shortText, the
// least-wrong string-valued format, rather than failing the create.
const RELATION_FORMAT_BY_NUMBER: Record<number, string> = {
	0: "longText",
	1: "shortText",
	2: "number",
	3: "select",
	4: "date",
	6: "checkbox",
	11: "multiSelect",
	100: "object",
};

export async function createObjectType(user: AuthUser, body: CommandBody) {
	const account = await ensureAccount(user);
	const spaceId =
		typeof body.spaceId === "string" && body.spaceId
			? body.spaceId
			: account.spaceId;
	const details = detailsOf(body);
	const name = typeof details.name === "string" ? details.name.trim() : "";

	const created = await objectTypeService.create(user, spaceId, {
		uniqueKey: mintRegistryKey(name, "type"),
		name: name || "Untitled",
	});

	return created;
}

// ObjectCreateRelation creates a custom relation in the space's registry. The client sends
// a numeric relationFormat and a name; the format is mapped to the Prisma enum and a
// registry-unique key is minted. Delegates to relationService.create for the writer-access
// check, the Relation row and its mirror Obj row (ADR-0005).
export async function createRelation(user: AuthUser, body: CommandBody) {
	const account = await ensureAccount(user);
	const spaceId =
		typeof body.spaceId === "string" && body.spaceId
			? body.spaceId
			: account.spaceId;
	const details = detailsOf(body);
	const name = typeof details.name === "string" ? details.name.trim() : "";
	const formatNumber =
		typeof details.relationFormat === "number" ? details.relationFormat : 1;
	const format = RELATION_FORMAT_BY_NUMBER[formatNumber] ?? "shortText";

	const created = await relationService.create(user, spaceId, {
		uniqueKey: mintRegistryKey(name, "relation"),
		format: format as CreateRelationInput["format"],
		name: name || "Untitled",
	});

	return created;
}

// ObjectSetObjectType re-points an object at a type chosen from the featured picker, which
// sends the type's uniqueKey rather than its id (featured.tsx:376). Resolve the type within
// the object's own space, require writer access, then set Obj.typeId (and keep the details
// JSONB `type` coherent, mirroring createObject). Returns the resolved type id, or null when
// the object or the type key does not exist so the shim can answer NOT_FOUND.
export async function setObjectType(
	user: AuthUser,
	contextId: string,
	typeUniqueKey: string,
) {
	const obj = await prisma.obj.findUnique({
		where: { id: contextId },
		select: { id: true, spaceId: true, details: true },
	});
	if (!obj) {
		return null;
	}

	await ensureSpaceAccess(user.id, obj.spaceId, "writer");

	const type = await prisma.objectType.findUnique({
		where: {
			spaceId_uniqueKey: { spaceId: obj.spaceId, uniqueKey: typeUniqueKey },
		},
		select: { id: true },
	});
	if (!type) {
		return null;
	}

	const details =
		obj.details && typeof obj.details === "object"
			? { ...(obj.details as Record<string, unknown>) }
			: {};

	await prisma.obj.update({
		where: { id: obj.id },
		data: { typeId: type.id, details: { ...details, type: [type.id] } },
	});

	return type.id;
}

// ObjectListSetObjectType is the multi-select sibling of ObjectSetObjectType: the "change type"
// action sends a batch of object ids plus one type uniqueKey (menu/object/context.tsx:299) and is
// fire-and-forget. Re-point every listed object at the type resolved by uniqueKey within that
// object's own space, requiring writer access to each space touched (fail closed if any is denied).
// Ids that do not exist are ignored; objects whose space lacks the key are left untouched. Returns
// the ids actually retyped, or null when nothing was retyped so the shim can answer NOT_FOUND.
export async function setObjectsType(
	user: AuthUser,
	objectIds: string[],
	typeUniqueKey: string,
) {
	const objs = await prisma.obj.findMany({
		where: { id: { in: objectIds } },
		select: { id: true, spaceId: true, details: true },
	});
	if (objs.length === 0) {
		return null;
	}

	const spaceIds = [...new Set(objs.map((it) => it.spaceId))];
	for (const spaceId of spaceIds) {
		await ensureSpaceAccess(user.id, spaceId, "writer");
	}

	const types = await prisma.objectType.findMany({
		where: { spaceId: { in: spaceIds }, uniqueKey: typeUniqueKey },
		select: { id: true, spaceId: true },
	});
	const typeBySpace = new Map(types.map((it) => [it.spaceId, it.id]));

	const retyped: string[] = [];
	for (const obj of objs) {
		const typeId = typeBySpace.get(obj.spaceId);
		if (!typeId) {
			continue;
		}

		const details =
			obj.details && typeof obj.details === "object"
				? { ...(obj.details as Record<string, unknown>) }
				: {};

		await prisma.obj.update({
			where: { id: obj.id },
			data: { typeId, details: { ...details, type: [typeId] } },
		});
		retyped.push(obj.id);
	}

	return retyped.length > 0 ? retyped : null;
}

// The empty value a relation starts at when it is hung off an object, keyed by the Prisma
// RelationFormat. Mirrors Anytype's per-format zero so the relation editor renders the right
// control (a checkbox reads false, a multi-relation an empty list) instead of a blank string.
function emptyValueForFormat(format: string): unknown {
	switch (format) {
		case "checkbox":
			return false;
		case "multiSelect":
		case "object":
			return [];
		case "number":
		case "date":
			return null;
		default:
			return "";
	}
}

// ObjectRelationAdd hangs existing relations off an object (block/relation.tsx:58,
// sidebar/page/object/relation.tsx:132). The object's "local" relation list is derived from the
// keys present on its record (record.ts:680 getConflictRelations -> S.Detail.getKeys), and the
// record spreads the details JSONB, so adding a relation means writing its key onto details —
// seeded with the relation's default or a format-appropriate empty. A key already present keeps
// its value (idempotent), and a key with no matching relation in the space is skipped. Returns the
// keys actually added, or null when the object does not exist so the shim can answer NOT_FOUND.
export async function addObjectRelations(
	user: AuthUser,
	contextId: string,
	relationKeys: string[],
) {
	const obj = await prisma.obj.findUnique({
		where: { id: contextId },
		select: { id: true, spaceId: true, details: true },
	});
	if (!obj) {
		return null;
	}

	await ensureSpaceAccess(user.id, obj.spaceId, "writer");

	const details =
		obj.details &&
		typeof obj.details === "object" &&
		!Array.isArray(obj.details)
			? { ...(obj.details as Record<string, unknown>) }
			: {};

	const wanted = relationKeys.filter((key) => !(key in details));
	if (wanted.length === 0) {
		return [];
	}

	const relations = await prisma.relation.findMany({
		where: { spaceId: obj.spaceId, uniqueKey: { in: wanted } },
		select: { uniqueKey: true, format: true, defaultValue: true },
	});
	const byKey = new Map(relations.map((it) => [it.uniqueKey, it]));

	const added: string[] = [];
	for (const key of wanted) {
		const relation = byKey.get(key);
		if (!relation) {
			continue;
		}
		details[key] =
			relation.defaultValue ?? emptyValueForFormat(relation.format);
		added.push(key);
	}

	if (added.length > 0) {
		await prisma.obj.update({
			where: { id: obj.id },
			data: { details: details as Prisma.InputJsonObject },
		});
	}

	return added;
}

// ObjectRelationDelete is the inverse of ObjectRelationAdd: it lifts relation keys off an object
// (sidebar/page/object/relation.tsx:105 'remove', util/object.ts:1113 clears 'layout'/'layoutAlign')
// by deleting them from the details JSONB, so they drop out of the object's local-relation list
// (record.ts:680 reads the projected keys). Keys the object does not carry are a no-op. Layout keeps
// projecting from the resolvedLayout column, so removing the redundant details.layout marker — which
// util/object.ts asks for by name — is harmless. Returns the keys actually removed, or null when the
// object does not exist so the shim can answer NOT_FOUND.
export async function removeObjectRelations(
	user: AuthUser,
	contextId: string,
	relationKeys: string[],
) {
	const obj = await prisma.obj.findUnique({
		where: { id: contextId },
		select: { id: true, spaceId: true, details: true },
	});
	if (!obj) {
		return null;
	}

	await ensureSpaceAccess(user.id, obj.spaceId, "writer");

	const details =
		obj.details &&
		typeof obj.details === "object" &&
		!Array.isArray(obj.details)
			? { ...(obj.details as Record<string, unknown>) }
			: {};

	const removed: string[] = [];
	for (const key of relationKeys) {
		if (key in details) {
			delete details[key];
			removed.push(key);
		}
	}

	if (removed.length > 0) {
		await prisma.obj.update({
			where: { id: obj.id },
			data: { details: details as Prisma.InputJsonObject },
		});
	}

	return removed;
}

// ObjectRelationAddFeatured / ObjectRelationRemoveFeatured are the two directions of
// action.ts:1295 toggleFeatureRelation, which moves a relation into or out of the featured block
// under an object's title. The featured keys live on details.featuredRelations and are read back
// verbatim through the projected record. "add" appends keys not already present (order-preserving,
// deduped); "remove" drops the listed keys. Returns the new featured list, or null when the object
// does not exist so the shim can answer NOT_FOUND.
export async function setFeaturedRelations(
	user: AuthUser,
	contextId: string,
	relationKeys: string[],
	mode: "add" | "remove",
) {
	const obj = await prisma.obj.findUnique({
		where: { id: contextId },
		select: { id: true, spaceId: true, details: true },
	});
	if (!obj) {
		return null;
	}

	await ensureSpaceAccess(user.id, obj.spaceId, "writer");

	const details =
		obj.details &&
		typeof obj.details === "object" &&
		!Array.isArray(obj.details)
			? { ...(obj.details as Record<string, unknown>) }
			: {};

	const current = Array.isArray(details.featuredRelations)
		? (details.featuredRelations as unknown[]).filter(
				(it): it is string => typeof it === "string",
			)
		: [];

	const next =
		mode === "add"
			? [...new Set([...current, ...relationKeys])]
			: current.filter((key) => !relationKeys.includes(key));

	details.featuredRelations = next;

	await prisma.obj.update({
		where: { id: obj.id },
		data: { details: details as Prisma.InputJsonObject },
	});

	return next;
}

export function objectDetails(obj: {
	id: string;
	name: string;
	typeId: string | null;
	snippet?: string | null;
	description?: string | null;
	resolvedLayout?: string | null;
	details?: Prisma.JsonValue;
}) {
	// Custom relation values live in the details JSONB (ADR-0002); the page's relation
	// editor reads them as top-level keys, so they are spread first and the system fields
	// below override any colliding key (id/name/layout/type/...).
	const custom =
		obj.details &&
		typeof obj.details === "object" &&
		!Array.isArray(obj.details)
			? (obj.details as Record<string, unknown>)
			: {};

	const layout = numericLayout(obj);

	return {
		...custom,
		id: obj.id,
		name: obj.name,
		layout,
		resolvedLayout: layout,
		type: obj.typeId ?? "",
		// The body's search text is a rebuildable projection of the Yjs document
		// (ADR-0018), persisted onto Obj.snippet by the collab store path.
		snippet: obj.snippet ?? "",
		description: obj.description ?? "",
	};
}

// The detail record ObjectCreateSet answers with (response.ts:224 maps it straight through): the
// set's own detail record — layout already projects as Set — plus its sources on setOf, so the
// dataview that opens the new object (dataview.tsx:964 onSelect) renders a set rather than a page.
export function createdSetDetails(obj: {
	id: string;
	name: string;
	typeId: string | null;
	snippet?: string | null;
	description?: string | null;
	details?: Prisma.JsonValue;
}) {
	const stored =
		obj.details &&
		typeof obj.details === "object" &&
		!Array.isArray(obj.details)
			? (obj.details as Record<string, unknown>)
			: {};
	const setOf = Array.isArray(stored.setOf) ? stored.setOf : [];

	return { ...objectDetails(obj), setOf };
}

// The detail record ObjectCreateFromUrl answers with (response.ts:231 maps it straight through): a
// page detail re-stamped with the Bookmark layout number and its url on `source`, so the bookmark
// that opens (bookmark.tsx:66 onSubmit) renders as a bookmark card rather than a plain page.
export function createdBookmarkDetails(obj: {
	id: string;
	name: string;
	typeId: string | null;
	snippet?: string | null;
	description?: string | null;
	details?: Prisma.JsonValue;
}) {
	const stored =
		obj.details &&
		typeof obj.details === "object" &&
		!Array.isArray(obj.details)
			? (obj.details as Record<string, unknown>)
			: {};
	const source = typeof stored.source === "string" ? stored.source : "";

	return { ...objectDetails(obj), source };
}

const DATE_MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

// A date object's title is a readable UTC day ("Jul 25, 2024"). The head actually renders a
// Date-layout object from its timestamp detail (simple.tsx:128), so the name is the fallback.
function dateObjectName(dayStart: number): string {
	const d = new Date(dayStart * 1000);
	return `${DATE_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// ObjectDateByTimestamp finds-or-creates the per-day Date object a date mention or date block
// links to (menu/block/mention.tsx:223, menu/block/add.tsx:412, lib/util/object.ts:779). Anytype
// keys exactly one object per day, so the id is derived from the space and the start of the UTC
// day, which makes repeat calls for that day idempotent. The timestamp rides on the details JSONB
// because the head renders a date object from it. Creating the row is a write, so the caller needs
// writer access to the space.
export async function findOrCreateDateObject(
	user: AuthUser,
	spaceId: string,
	timestamp: number,
) {
	await ensureSpaceAccess(user.id, spaceId, "writer");

	const seconds = Number.isFinite(timestamp) ? Math.floor(timestamp) : 0;
	const dayStart = Math.floor(seconds / SECONDS_PER_DAY) * SECONDS_PER_DAY;
	const id = `_date_${spaceId.replace(/\./g, "_")}_${dayStart}`;

	return prisma.obj.upsert({
		where: { id },
		create: {
			id,
			spaceId,
			name: dateObjectName(dayStart),
			resolvedLayout: "date",
			details: { timestamp: dayStart } as Prisma.InputJsonObject,
			creatorId: user.id,
		},
		update: {},
	});
}

// The detail record ObjectDateByTimestamp answers with (response.ts:439 maps it straight through):
// a page detail re-stamped with the Date layout number and the day's timestamp, so the caller can
// link to it (getLinkBlockParam uses id + layout) or open it as a date.
export function createdDateDetails(obj: {
	id: string;
	name: string;
	typeId: string | null;
	snippet?: string | null;
	description?: string | null;
	details?: Prisma.JsonValue;
}) {
	const stored =
		obj.details &&
		typeof obj.details === "object" &&
		!Array.isArray(obj.details)
			? (obj.details as Record<string, unknown>)
			: {};
	const timestamp = typeof stored.timestamp === "number" ? stored.timestamp : 0;

	return { ...objectDetails(obj), timestamp };
}

export async function loadObjectView(user: AuthUser, objectId: string) {
	const obj = await prisma.obj.findUnique({ where: { id: objectId } });
	if (!obj || obj.isDeleted) {
		return null;
	}

	await ensureSpaceAccess(user.id, obj.spaceId, "reader");

	const rows = await prisma.block.findMany({ where: { objectId } });

	const byParent = new Map<string, typeof rows>();
	for (const row of rows) {
		const key = row.parentId ?? "";
		const list = byParent.get(key);
		if (list) {
			list.push(row);
		} else {
			byParent.set(key, [row]);
		}
	}
	for (const list of byParent.values()) {
		list.sort((a, b) => a.index.localeCompare(b.index));
	}

	const childrenIds = (parentId: string) =>
		(byParent.get(parentId) ?? []).map((it) => it.id);

	// A set screen draws only its dataview child (page/main/set.tsx:248), so the view objects are
	// ensured here and projected inline — this client has no view-object subscription to fill them.
	// A type screen opens the TYPE object at the same route, and the dataview resolves its query's
	// sources from the record's `setOf` (block/dataview.tsx:401), so a type is healed into a set over
	// its own objects: without both the views and that source, the type page is a header over nothing.
	// A collection routes to the same screen (U.Object.getSetLayouts), so it is healed the same way.
	let dataview = null;
	let viewRow = obj;
	const viewLayout = numericLayout(obj);
	if (
		viewLayout === LAYOUT_SET ||
		viewLayout === LAYOUT_TYPE ||
		viewLayout === LAYOUT_COLLECTION
	) {
		if (viewLayout === LAYOUT_TYPE || viewLayout === LAYOUT_COLLECTION) {
			// The default view object is created against a source type, so both of these point their
			// setOf at themselves. Only a type's rows then come from that source: a collection's arrive
			// through the collectionId the screen sends in place of a query source.
			const stored =
				obj.details &&
				typeof obj.details === "object" &&
				!Array.isArray(obj.details)
					? (obj.details as Record<string, unknown>)
					: {};
			if (!Array.isArray(stored.setOf) || stored.setOf.length === 0) {
				viewRow = await prisma.obj.update({
					where: { id: obj.id },
					data: { details: { ...stored, setOf: [obj.id] } },
				});
			}
		}
		const healed = await ensureSetViews(
			obj.spaceId,
			obj.creatorId ?? "",
			viewRow,
			true,
		);
		dataview = await dataviewBlockFor(
			obj.spaceId,
			healed,
			viewLayout === LAYOUT_COLLECTION,
		);
	}

	const rootChildren = childrenIds("");

	const blocks = [
		{
			id: obj.id,
			childrenIds: dataview
				? [...rootChildren, DATAVIEW_BLOCK_ID]
				: rootChildren,
			fields: {},
			smartblock: {},
		},
		...(dataview
			? [
					{
						id: DATAVIEW_BLOCK_ID,
						childrenIds: [],
						fields: {},
						align: 0,
						verticalAlign: 0,
						backgroundColor: "",
						dataview,
					},
				]
			: []),
		...rows.map((row) =>
			row.type === "link"
				? {
						id: row.id,
						childrenIds: childrenIds(row.id),
						fields: {},
						align: 0,
						link: {
							targetBlockId: row.linkTargetId ?? "",
							iconSize: 0,
							cardStyle: 0,
							description: 0,
							relations: [],
						},
					}
				: {
						id: row.id,
						childrenIds: childrenIds(row.id),
						fields: {},
						align: 0,
						text: {
							text: row.text,
							style: STYLE_TO_TEXT_STYLE[row.style] ?? 0,
							marks: [],
						},
					},
		),
	];

	return {
		rootId: obj.id,
		blocks,
		details: [{ id: obj.id, details: objectDetails(viewRow) }],
		restrictions: { object: [], dataview: [] },
		blockParticipants: [],
	};
}

// HistoryShowVersion previews a stored version, and the client paints that preview from the
// objectView's block tree. A Yjs body's Block rows are the object's *current* rows — often
// none at all (ADR-0018) — so the version's own paragraphs are projected into the view here.
// The projected ids are the line ordinals (bodyLineId), shared by every version, because
// HistoryDiffVersions keys its change events by them and the pane never writes blocks back;
// restoring goes through HistorySetVersion.
export function versionBodyView(
	view: Awaited<ReturnType<typeof loadObjectView>>,
	objectId: string,
	lines: string[],
) {
	if (!view) {
		return view;
	}

	const blocks = lines.map((text, index) => ({
		id: bodyLineId(objectId, index + 1),
		childrenIds: [],
		fields: {},
		align: 0,
		text: { text, style: 0, marks: [] },
	}));

	return {
		...view,
		blocks: [
			{
				id: objectId,
				childrenIds: blocks.map((block) => block.id),
				fields: {},
				smartblock: {},
			},
			...blocks,
		],
	};
}

// The client's personal widgets object is synthetic: its id is derived from the space id
// (`_personalWidgets_<spaceId with dots as underscores>`, util/object.ts:28) and no Obj row is
// ever written for it. ObjectOpen still owes the caller a view for a member of that space, or
// every space switch logs "ObjectOpen code: 3 Object not found". The space is taken from the
// request when present — decoding the id back with `_`→`.` is lossy for ids that contain
// underscores — and only then from the id itself.
const PERSONAL_WIDGETS_PREFIX = "_personalWidgets_";

export function isPersonalWidgetsId(objectId: string) {
	return objectId.startsWith(PERSONAL_WIDGETS_PREFIX);
}

export async function personalWidgetsView(
	user: AuthUser,
	objectId: string,
	spaceId: string,
) {
	const resolvedSpaceId =
		spaceId ||
		objectId.slice(PERSONAL_WIDGETS_PREFIX.length).replace(/_/g, ".");

	await ensureSpaceAccess(user.id, resolvedSpaceId, "reader");

	return {
		rootId: objectId,
		blocks: [{ id: objectId, childrenIds: [], fields: {}, smartblock: {} }],
		details: [
			{
				id: objectId,
				details: {
					id: objectId,
					space: resolvedSpaceId,
					name: "Personal widgets",
				},
			},
		],
		restrictions: { object: [], dataview: [] },
		blockParticipants: [],
	};
}

// ObjectListDelete / ObjectListSetIsArchived can target objects across several
// spaces, so every distinct space behind the batch must grant the caller writer
// access before any row is touched. ensureSpaceAccess throws on the first space the
// caller cannot write, and the command shim turns that into a FORBIDDEN envelope.
async function ensureWritableSpaces(user: AuthUser, objectIds: string[]) {
	const rows = await prisma.obj.findMany({
		where: { id: { in: objectIds } },
		select: { spaceId: true },
	});

	for (const spaceId of new Set(rows.map((row) => row.spaceId))) {
		await ensureSpaceAccess(user.id, spaceId, "writer");
	}
}

export async function softDeleteObjects(user: AuthUser, objectIds: string[]) {
	await ensureWritableSpaces(user, objectIds);
	await prisma.obj.updateMany({
		where: { id: { in: objectIds } },
		data: { isDeleted: true, deletedDate: new Date(), deletedBy: user.id },
	});
}

export async function setObjectsArchived(
	user: AuthUser,
	objectIds: string[],
	isArchived: boolean,
) {
	await ensureWritableSpaces(user, objectIds);
	await prisma.obj.updateMany({
		where: { id: { in: objectIds } },
		data: { isArchived },
	});
}

// ObjectListDuplicate ('pageCopy', menu/object.tsx:447) copies each listed object into a
// fresh row: its content columns plus the details JSONB (so custom relation values and
// setOf/object references survive), its Yjs body (DocumentState, ADR-0018) and its outbound
// Link rows (ADR-0002 collection membership). Inbound links stay pointed at the source, and
// the is{Archived,Deleted,Hidden,Favorite} flags reset to their fresh defaults. The caller
// must be able to write every space a source lives in (fail closed on the first denial).
// Returns the new ids in request order — the client opens ids[0] as the copy of objectIds[0]
// — or null when nothing was duplicated so the shim can answer NOT_FOUND.
export async function duplicateObjects(user: AuthUser, objectIds: string[]) {
	if (objectIds.length === 0) {
		return null;
	}

	const sources = await prisma.obj.findMany({
		where: { id: { in: objectIds } },
	});
	if (sources.length === 0) {
		return null;
	}

	for (const spaceId of new Set(sources.map((it) => it.spaceId))) {
		await ensureSpaceAccess(user.id, spaceId, "writer");
	}

	const sourceIds = sources.map((it) => it.id);
	const byId = new Map(sources.map((it) => [it.id, it]));

	const states = await prisma.documentState.findMany({
		where: { objectId: { in: sourceIds } },
	});
	const stateByObject = new Map(states.map((it) => [it.objectId, it.state]));

	const links = await prisma.link.findMany({
		where: { fromId: { in: sourceIds } },
	});
	const linksByFrom = new Map<string, typeof links>();
	for (const link of links) {
		const list = linksByFrom.get(link.fromId);
		if (list) {
			list.push(link);
		} else {
			linksByFrom.set(link.fromId, [link]);
		}
	}

	// Iterate the request ids (not the fetched rows) so the returned ids line up with the
	// request order even when some ids are unknown or duplicated.
	const createdIds: string[] = [];
	for (const id of objectIds) {
		const source = byId.get(id);
		if (!source) {
			continue;
		}

		const created = await prisma.obj.create({
			data: {
				spaceId: source.spaceId,
				typeId: source.typeId,
				layout: source.layout,
				resolvedLayout: source.resolvedLayout,
				name: source.name,
				description: source.description,
				snippet: source.snippet,
				iconEmoji: source.iconEmoji,
				details: (source.details ?? {}) as Prisma.InputJsonObject,
				done: source.done,
				creatorId: user.id,
			},
		});
		createdIds.push(created.id);

		const state = stateByObject.get(source.id);
		if (state) {
			await prisma.documentState.create({
				data: { objectId: created.id, state },
			});
		}

		const outbound = linksByFrom.get(source.id);
		if (outbound && outbound.length > 0) {
			await prisma.link.createMany({
				data: outbound.map((link) => ({
					spaceId: created.spaceId,
					fromId: created.id,
					toId: link.toId,
					relationKey: link.relationKey,
					sortOrder: link.sortOrder,
				})),
			});
		}
	}

	return createdIds.length > 0 ? createdIds : null;
}

const TEMPLATE_TYPE_KEY = "ot-template";

// A template is an Obj typed ot-template. A fresh space seeds no default types, so the first
// template mints the type rather than failing; later calls reuse it. The caller has already
// established writer access to the space the source lives in, which objectTypeService.create
// re-checks for the same space.
async function ensureTemplateType(
	user: AuthUser,
	spaceId: string,
): Promise<string> {
	const existing = await prisma.objectType.findUnique({
		where: { spaceId_uniqueKey: { spaceId, uniqueKey: TEMPLATE_TYPE_KEY } },
		select: { id: true },
	});
	if (existing) {
		return existing.id;
	}
	const created = await objectTypeService.create(user, spaceId, {
		uniqueKey: TEMPLATE_TYPE_KEY,
		name: "Template",
	});
	return created.id;
}

// TemplateCreateFromObject ('templateCreate', menu/object.tsx:526) mints a template from an
// existing object: a fresh Obj typed ot-template whose details.targetObjectType points back at
// the source's type, so the type's template rail (sidebar/section/type/template.tsx) lists it.
// It copies the source's content columns and details JSONB (so custom relation values survive)
// plus its Yjs body (DocumentState, ADR-0018) — like duplicateObjects, but retyped to ot-template
// and re-pointed at the source's type rather than keeping it. The caller must be able to write
// the source's space. Returns the new template's id, or null when the source does not exist so
// the shim can answer NOT_FOUND.
export async function createTemplateFromObject(
	user: AuthUser,
	contextId: string,
): Promise<string | null> {
	const source = await prisma.obj.findUnique({ where: { id: contextId } });
	if (!source) {
		return null;
	}
	await ensureSpaceAccess(user.id, source.spaceId, "writer");

	const templateTypeId = await ensureTemplateType(user, source.spaceId);

	// The template carries the source's custom details but its own identity: type is
	// ot-template (not the source's type) and targetObjectType records which type's rail it
	// belongs on. An untyped source yields an empty targetObjectType — it lists under no type.
	const persisted: Record<string, unknown> = {
		...((source.details ?? {}) as Record<string, unknown>),
		layout: "page",
		type: [templateTypeId],
		targetObjectType: source.typeId ? [source.typeId] : [],
	};

	const created = await prisma.obj.create({
		data: {
			spaceId: source.spaceId,
			typeId: templateTypeId,
			layout: source.layout,
			resolvedLayout: source.resolvedLayout,
			name: source.name,
			description: source.description,
			snippet: source.snippet,
			iconEmoji: source.iconEmoji,
			details: persisted as Prisma.InputJsonObject,
			done: source.done,
			creatorId: user.id,
		},
	});

	const state = await prisma.documentState.findUnique({
		where: { objectId: source.id },
	});
	if (state) {
		await prisma.documentState.create({
			data: { objectId: created.id, state: state.state },
		});
	}

	return created.id;
}

// ObjectApplyTemplate (banner.tsx:60, featured.tsx:378) replaces an object's content with a
// template's. The body is a folded Yjs document (DocumentState, ADR-0018), so applying a
// template overwrites the target's DocumentState with a copy of the template's — the target
// keeps its own id, name and type (applying does not retype or rename). A template with no body
// clears the target's, so the two match. The caller must be able to write the target's space and
// read the template's. Returns false when either object is missing so the shim answers
// NOT_FOUND.
export async function applyTemplate(
	user: AuthUser,
	contextId: string,
	templateId: string,
): Promise<boolean> {
	const target = await prisma.obj.findUnique({ where: { id: contextId } });
	if (!target) {
		return false;
	}
	const template = await prisma.obj.findUnique({ where: { id: templateId } });
	if (!template) {
		return false;
	}

	await ensureSpaceAccess(user.id, target.spaceId, "writer");
	if (template.spaceId !== target.spaceId) {
		await ensureSpaceAccess(user.id, template.spaceId, "reader");
	}

	const state = await prisma.documentState.findUnique({
		where: { objectId: template.id },
	});
	if (state) {
		await prisma.documentState.upsert({
			where: { objectId: target.id },
			create: { objectId: target.id, state: state.state },
			update: { state: state.state },
		});
	} else {
		await prisma.documentState.deleteMany({ where: { objectId: target.id } });
	}

	return true;
}

// Collection membership is an ordered object-valued relation, so Link is its store
// (ADR-0002). Add appends after the current last member; the caller must be able to
// write the space the collection lives in. Returns the collection's spaceId, or null
// when the collection object does not exist, so the shim can answer NOT_FOUND.
export async function addCollectionMembers(
	user: AuthUser,
	collectionId: string,
	objectIds: string[],
) {
	const collection = await prisma.obj.findUnique({
		where: { id: collectionId },
		select: { spaceId: true },
	});
	if (!collection) {
		return null;
	}

	await ensureSpaceAccess(user.id, collection.spaceId, "writer");

	const existing = await prisma.link.count({
		where: { fromId: collectionId, relationKey: COLLECTION_RELATION },
	});

	const rows = objectIds.map((toId, index) => ({
		spaceId: collection.spaceId,
		fromId: collectionId,
		toId,
		relationKey: COLLECTION_RELATION,
		sortOrder: String(existing + index + 1).padStart(4, "0"),
	}));

	if (rows.length > 0) {
		await prisma.link.createMany({ data: rows });
	}

	return collection.spaceId;
}

export async function removeCollectionMembers(
	user: AuthUser,
	collectionId: string,
	objectIds: string[],
) {
	const collection = await prisma.obj.findUnique({
		where: { id: collectionId },
		select: { spaceId: true },
	});
	if (!collection) {
		return null;
	}

	await ensureSpaceAccess(user.id, collection.spaceId, "writer");
	await prisma.link.deleteMany({
		where: {
			fromId: collectionId,
			relationKey: COLLECTION_RELATION,
			toId: { in: objectIds },
		},
	});

	return collection.spaceId;
}

// ObjectToCollection flips an object's layout so the shell treats it as a collection
// (U.Object.isCollectionLayout reads the numeric layout the record projects). The
// layout marker lives in details too, mirroring how createObject records "page".
// Returns the object's spaceId, or null when the object does not exist.
export async function convertToCollection(user: AuthUser, objectId: string) {
	const obj = await prisma.obj.findUnique({
		where: { id: objectId },
		select: { spaceId: true, details: true },
	});
	if (!obj) {
		return null;
	}

	await ensureSpaceAccess(user.id, obj.spaceId, "writer");

	const details =
		obj.details && typeof obj.details === "object"
			? (obj.details as Record<string, unknown>)
			: {};

	await prisma.obj.update({
		where: { id: objectId },
		data: {
			resolvedLayout: "collection",
			details: { ...details, layout: "collection" },
		},
	});

	return obj.spaceId;
}

// ObjectToSet flips an object's layout to Set (Anytype I.ObjectLayout.Set === 3) and stores
// its sources — the type ids the set queries — on details.setOf, mirroring how the client
// reads a set's `setOf` relation (lib/dataview.ts getRecords). The records themselves come
// back through ObjectSearchSubscribe carrying `sources`, not from anything stored here.
// Returns the object's spaceId, or null when the object does not exist.
export async function convertToSet(
	user: AuthUser,
	objectId: string,
	sources: string[],
) {
	const obj = await prisma.obj.findUnique({
		where: { id: objectId },
		select: { spaceId: true, details: true },
	});
	if (!obj) {
		return null;
	}

	await ensureSpaceAccess(user.id, obj.spaceId, "writer");

	const details =
		obj.details && typeof obj.details === "object"
			? (obj.details as Record<string, unknown>)
			: {};

	await prisma.obj.update({
		where: { id: objectId },
		data: {
			resolvedLayout: "set",
			details: { ...details, layout: "set", setOf: sources },
		},
	});

	return obj.spaceId;
}

// ObjectSetSource rewrites a set's sources without touching its layout. Returns the
// object's spaceId, or null when the object does not exist.
export async function setObjectSources(
	user: AuthUser,
	objectId: string,
	sources: string[],
) {
	const obj = await prisma.obj.findUnique({
		where: { id: objectId },
		select: { spaceId: true, details: true },
	});
	if (!obj) {
		return null;
	}

	await ensureSpaceAccess(user.id, obj.spaceId, "writer");

	const details =
		obj.details && typeof obj.details === "object"
			? (obj.details as Record<string, unknown>)
			: {};

	await prisma.obj.update({
		where: { id: objectId },
		data: { details: { ...details, setOf: sources } },
	});

	return obj.spaceId;
}

// ObjectListSetDetails is the client's single write path for relation values: rename, custom
// relations and checkboxes all funnel here (command.ts:1394). System keys map onto their Obj
// columns; every other key is a custom relation and merges into the details JSONB, preserving
// the layout marker already stored there. Returns the ids that did not exist so the caller can
// answer NOT_FOUND; a caller without write access makes ensureSpaceAccess throw.
export async function setObjectDetails(
	user: AuthUser,
	entries: { id: string; details: Record<string, unknown> }[],
) {
	const missing: string[] = [];

	for (const entry of entries) {
		const obj = await prisma.obj.findUnique({
			where: { id: entry.id },
			select: { id: true, spaceId: true, details: true },
		});
		if (!obj) {
			missing.push(entry.id);
			continue;
		}

		await ensureSpaceAccess(user.id, obj.spaceId, "writer");

		const merged: Record<string, unknown> =
			obj.details && typeof obj.details === "object"
				? { ...(obj.details as Record<string, unknown>) }
				: {};
		const data: Prisma.ObjUncheckedUpdateInput = {};

		const incoming =
			entry.details && typeof entry.details === "object" ? entry.details : {};
		for (const [key, value] of Object.entries(incoming)) {
			switch (key) {
				case "name":
					data.name = String(value);
					break;
				case "description":
					data.description = value == null ? null : String(value);
					break;
				case "snippet":
					data.snippet = value == null ? null : String(value);
					break;
				case "iconEmoji":
					data.iconEmoji = value == null ? null : String(value);
					break;
				case "done":
					data.done = Boolean(value);
					break;
				case "isFavorite":
					data.isFavorite = Boolean(value);
					break;
				case "isArchived":
					data.isArchived = Boolean(value);
					break;
				case "isHidden":
					data.isHidden = Boolean(value);
					break;
				case "type": {
					const typeId = typeIdOf({ type: value });
					if (typeId) {
						data.typeId = typeId;
					}
					merged.type = value;
					break;
				}
				default:
					merged[key] = value;
			}
		}

		data.details = merged as Prisma.InputJsonObject;
		await prisma.obj.update({ where: { id: obj.id }, data });
	}

	return { missing };
}

// A relation value is normalized to a list so add/remove are well-defined whether the stored
// value is an array (multiSelect/object relations), a scalar, or absent. undefined/null become
// an empty list; a scalar becomes a one-item list.
const asValueList = (value: unknown): unknown[] => {
	if (Array.isArray(value)) {
		return value;
	}
	return value === undefined || value === null ? [] : [value];
};

// Append to an array-valued relation, de-duplicated (a tag added twice is still one tag).
const addValues = (existing: unknown, add: unknown): unknown[] => {
	const ret = [...asValueList(existing)];
	for (const item of asValueList(add)) {
		if (!ret.includes(item)) {
			ret.push(item);
		}
	}
	return ret;
};

// Drop value(s) from an array-valued relation; anything not present is a no-op.
const removeValues = (existing: unknown, remove: unknown): unknown[] => {
	const drop = asValueList(remove);
	return asValueList(existing).filter((item) => !drop.includes(item));
};

// ObjectListModifyDetailValues is the batch relation-value editor: the dataview bulk action
// (block/dataview.tsx:1179) and the multi-object relation popup (popup/relation.tsx:222) send a
// list of operations, each carrying exactly one of add/set/remove (a proto oneof) for one
// relationKey. It writes the same Obj.details JSONB setObjectDetails does, so a later read
// projects the value back as record[relationKey]. `set` replaces the value outright (scalar
// relations and single select); `add`/`remove` mutate an array-valued relation (multiSelect tags
// and object relations). Returns the ids that did not exist so the caller can answer NOT_FOUND,
// mirroring setObjectDetails; a caller without write access makes ensureSpaceAccess throw.
export async function modifyObjectDetailValues(
	user: AuthUser,
	objectIds: string[],
	operations: {
		relationKey: string;
		add?: unknown;
		set?: unknown;
		remove?: unknown;
	}[],
) {
	const missing: string[] = [];

	for (const id of objectIds) {
		const obj = await prisma.obj.findUnique({
			where: { id },
			select: { id: true, spaceId: true, details: true },
		});
		if (!obj) {
			missing.push(id);
			continue;
		}

		await ensureSpaceAccess(user.id, obj.spaceId, "writer");

		const details: Record<string, unknown> =
			obj.details && typeof obj.details === "object"
				? { ...(obj.details as Record<string, unknown>) }
				: {};

		for (const op of operations) {
			const key = op?.relationKey;
			if (typeof key !== "string" || !key) {
				continue;
			}
			if (op.set !== undefined) {
				details[key] = op.set;
			} else if (op.add !== undefined) {
				details[key] = addValues(details[key], op.add);
			} else if (op.remove !== undefined) {
				details[key] = removeValues(details[key], op.remove);
			}
		}

		await prisma.obj.update({
			where: { id: obj.id },
			data: { details: details as Prisma.InputJsonObject },
		});
	}

	return { missing };
}
