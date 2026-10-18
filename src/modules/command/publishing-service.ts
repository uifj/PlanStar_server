import { ensureSpaceAccess } from "../../auth/space-access.js";
import { API_PREFIX } from "../../config/constants.js";
import { env } from "../../config/env.js";
import type { AuthUser } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { bodyTextFromState } from "../collab/projection.js";
import { objectDetails } from "./object-service.js";

// Anytype I.PublishStatus (interface/publish.ts): Created 0, Published 1. A stored row is always
// Published — publishing is synchronous here, so the transient Created state never persists.
const STATUS_PUBLISHED = 1;

// The wire shape Mapper.From.PublishState reads (mapper.ts:992). `uri` is the slug, `version` a
// string, `timestamp`/`size` numbers, and `details` the object's detail projection (the settings
// list renders IconObject/ObjectName/type from it via S.Detail.mapper).
export interface PublishStateWire {
	spaceId: string;
	objectId: string;
	uri: string;
	status: number;
	version: string;
	timestamp: number;
	size: number;
	details: Record<string, unknown>;
	joinSpace: boolean;
}

// The command shim maps a thrown PublishError onto its { code, description } envelope; the code
// mirrors the client's numeric error space (BAD_INPUT 1, OBJECT_NOT_FOUND 3). Anything else the
// service throws (notably ensureSpaceAccess) falls through to FORBIDDEN in the caller.
export class PublishError extends Error {
	constructor(
		public code: number,
		description: string,
	) {
		super(description);
	}
}

const NOT_FOUND = new PublishError(3, "Object not found.");
const INVALID_URI = new PublishError(1, "Publish address is invalid.");
const URI_TAKEN = new PublishError(1, "Publish address is already in use.");

// The public URL the client opens with Action.openUrl after publishing (menu/publish.tsx:80). It is
// served by this backend's public gateway route, built from the API's own origin the same way
// account-service builds gatewayUrl. The stored `uri` column keeps just the slug, which is what
// PublishState.uri round-trips into the menu's editable slug field.
function publishUrl(slug: string): string {
	return `${env.APP_URL}${API_PREFIX}/publish/${slug}`;
}

// The client slugifies before sending (U.String.slug), so this only guards the value that reaches a
// URL path: it must be a single non-empty segment. Rejecting "/" keeps GET /publish/:uri addressable.
function normalizeSlug(uri: string): string {
	const slug = uri.trim();
	if (!slug || slug.includes("/") || /\s/.test(slug)) {
		throw INVALID_URI;
	}
	return slug;
}

// The published size is the body's stored byte length (the folded Yjs update). An object with no
// document yet publishes at size 0.
async function bodySize(objectId: string): Promise<number> {
	const state = await prisma.documentState.findUnique({
		where: { objectId },
		select: { state: true },
	});
	return state ? state.state.length : 0;
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: string }).code === "P2002"
	);
}

// PublishingCreate { spaceId, objectId, uri, joinSpace } (command.ts:2103): bind an object to a public
// slug and return the gateway URL. Writer-gated; the object must live in the target space. Re-publishing
// the same object upserts (new slug/joinSpace, bumped version, refreshed size/timestamp). A slug is a
// globally-unique public address, so one already owned by a different object is refused.
export async function publishObject(
	user: AuthUser,
	spaceId: string,
	objectId: string,
	uri: string,
	joinSpace: boolean,
): Promise<{ uri: string }> {
	await ensureSpaceAccess(user.id, spaceId, "writer");

	const slug = normalizeSlug(uri);

	const obj = await prisma.obj.findFirst({
		where: { id: objectId, spaceId, isDeleted: false },
		select: { id: true },
	});
	if (!obj) {
		throw NOT_FOUND;
	}

	const byUri = await prisma.publishedObject.findUnique({
		where: { uri: slug },
		select: { spaceId: true, objectId: true },
	});
	if (byUri && (byUri.spaceId !== spaceId || byUri.objectId !== objectId)) {
		throw URI_TAKEN;
	}

	const size = await bodySize(objectId);
	const timestamp = BigInt(Math.floor(Date.now() / 1000));

	try {
		await prisma.publishedObject.upsert({
			where: { spaceId_objectId: { spaceId, objectId } },
			create: {
				spaceId,
				objectId,
				uri: slug,
				joinSpace,
				version: 1,
				size,
				timestamp,
				publishedBy: user.id,
			},
			update: {
				uri: slug,
				joinSpace,
				size,
				timestamp,
				version: { increment: 1 },
			},
		});
	} catch (error) {
		// The @@unique([uri]) constraint is the real guard against a concurrent publish grabbing the
		// same slug between the check above and the write; surface it as the same conflict.
		if (isUniqueViolation(error)) {
			throw URI_TAKEN;
		}
		throw error;
	}

	return { uri: publishUrl(slug) };
}

type PublishedRow = {
	spaceId: string;
	objectId: string;
	uri: string;
	joinSpace: boolean;
	version: number;
	size: number;
	timestamp: bigint;
};

function publishState(
	row: PublishedRow,
	details: Record<string, unknown>,
): PublishStateWire {
	return {
		spaceId: row.spaceId,
		objectId: row.objectId,
		uri: row.uri,
		status: STATUS_PUBLISHED,
		version: String(row.version),
		timestamp: Number(row.timestamp),
		size: row.size,
		details,
		joinSpace: row.joinSpace,
	};
}

// PublishingGetStatus { spaceId, objectId } (command.ts:2127): the object's live publish state, or null
// when it is not published — the menu shows Publish vs Unpublish/Update off this (menu/publish.tsx:127).
// Reader-gated: any space member can see whether an object is public.
export async function getPublishStatus(
	user: AuthUser,
	spaceId: string,
	objectId: string,
): Promise<PublishStateWire | null> {
	await ensureSpaceAccess(user.id, spaceId, "reader");

	const row = await prisma.publishedObject.findUnique({
		where: { spaceId_objectId: { spaceId, objectId } },
	});
	if (!row) {
		return null;
	}

	const obj = await prisma.obj.findUnique({ where: { id: row.objectId } });
	const details = obj ? objectDetails(obj) : { id: row.objectId };
	return publishState(row, details);
}

// PublishingRemove { spaceId, objectId } (command.ts:2112): unpublish, deleting the binding so the
// public gateway stops serving it and GetStatus returns null. Writer-gated. deleteMany makes
// unpublishing an object that was never published a safe no-op rather than an error.
export async function removePublished(
	user: AuthUser,
	spaceId: string,
	objectId: string,
): Promise<void> {
	await ensureSpaceAccess(user.id, spaceId, "writer");
	await prisma.publishedObject.deleteMany({ where: { spaceId, objectId } });
}

// PublishingList { spaceId } (command.ts:2119): the published objects the settings list renders
// (settings/data/publish.tsx). An empty spaceId means "all my spaces" — the caller passes '' there —
// so the readable set is derived from active membership, mirroring crossSpaceSearchRecords. A given
// spaceId is reader-gated to that one space. Object details are batch-fetched to avoid an N+1.
export async function listPublished(
	user: AuthUser,
	spaceId: string,
): Promise<PublishStateWire[]> {
	let spaceIds: string[];
	if (spaceId) {
		await ensureSpaceAccess(user.id, spaceId, "reader");
		spaceIds = [spaceId];
	} else {
		const memberships = await prisma.spaceMember.findMany({
			where: { userId: user.id, status: "active" },
			select: { spaceId: true },
		});
		spaceIds = memberships.map((member) => member.spaceId);
		if (spaceIds.length === 0) {
			return [];
		}
	}

	const rows = await prisma.publishedObject.findMany({
		where: { spaceId: { in: spaceIds } },
		orderBy: { timestamp: "desc" },
	});
	if (rows.length === 0) {
		return [];
	}

	const objectIds = [...new Set(rows.map((row) => row.objectId))];
	const objects = await prisma.obj.findMany({
		where: { id: { in: objectIds } },
	});
	const detailsById = new Map(
		objects.map((obj) => [obj.id, objectDetails(obj)]),
	);

	return rows.map((row) =>
		publishState(row, detailsById.get(row.objectId) ?? { id: row.objectId }),
	);
}

// The content the public gateway route serves at GET /publish/:uri (the self-hosted equivalent of
// the any.co publish page the client opens with Action.openUrl). Anonymous by design — a published
// object is world-readable — so there is no ensureSpaceAccess here. The body is decoded from the
// stored Yjs document (ADR-0018) rather than served as raw bytes; null means the slug resolves to
// nothing live (unknown, unpublished, or its object was deleted), which the route turns into a 404.
export interface PublishedContent {
	uri: string;
	objectId: string;
	spaceId: string;
	name: string;
	description: string;
	details: Record<string, unknown>;
	body: string;
	joinSpace: boolean;
}

export async function readPublished(
	slug: string,
): Promise<PublishedContent | null> {
	const row = await prisma.publishedObject.findUnique({ where: { uri: slug } });
	if (!row) {
		return null;
	}

	const obj = await prisma.obj.findFirst({
		where: { id: row.objectId, isDeleted: false },
	});
	if (!obj) {
		return null;
	}

	const state = await prisma.documentState.findUnique({
		where: { objectId: row.objectId },
		select: { state: true },
	});
	const body = state ? bodyTextFromState(new Uint8Array(state.state)) : "";

	return {
		uri: row.uri,
		objectId: row.objectId,
		spaceId: row.spaceId,
		name: obj.name,
		description: obj.description ?? "",
		details: objectDetails(obj),
		body,
		joinSpace: row.joinSpace,
	};
}
