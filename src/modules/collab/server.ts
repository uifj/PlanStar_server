import { Database } from "@hocuspocus/extension-database";
import { Hocuspocus } from "@hocuspocus/server";
import { ensureSpaceAccess } from "../../auth/space-access.js";
import { auth } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { BLOCK_LINK_RELATION } from "../blocks/constants.js";
import {
	bodySnippetFromState,
	objectLinkTargetsFromState,
} from "./projection.js";

interface CollabOptions {
	debounce?: number;
	maxDebounce?: number;
}

// The body's objectLink mentions are the page's edges (ADR-0013), so each store rebuilds
// the source object's "links" rows from the decoded document. Targets are validated against
// the object's own space before writing so a stale or cross-space reference can never raise a
// foreign-key error and block the collab store itself.
async function syncBodyLinks(objectId: string, state: Uint8Array) {
	const object = await prisma.obj.findUnique({
		where: { id: objectId },
		select: { spaceId: true },
	});

	if (!object) {
		return;
	}

	const candidates = objectLinkTargetsFromState(state).filter(
		(target) => target !== objectId,
	);
	const existing =
		candidates.length > 0
			? await prisma.obj.findMany({
					where: { spaceId: object.spaceId, id: { in: candidates } },
					select: { id: true },
				})
			: [];
	const targets = existing.map((row) => row.id);

	await prisma.$transaction([
		prisma.link.deleteMany({
			where: { fromId: objectId, relationKey: BLOCK_LINK_RELATION },
		}),
		...(targets.length > 0
			? [
					prisma.link.createMany({
						data: targets.map((toId) => ({
							spaceId: object.spaceId,
							fromId: objectId,
							toId,
							relationKey: BLOCK_LINK_RELATION,
						})),
					}),
				]
			: []),
	]);
}

// Snapshots every folded body write so the History panel (right.tsx) can list, preview,
// diff and restore prior versions (Anytype Rpc.History). authorId is the last editor
// resolved from the collab session, or null for a server-side/test write.
async function captureVersion(
	objectId: string,
	state: Uint8Array,
	authorId: string | null,
) {
	const object = await prisma.obj.findUnique({
		where: { id: objectId },
		select: { spaceId: true },
	});

	if (!object) {
		return;
	}

	await prisma.documentVersion.create({
		data: {
			objectId,
			spaceId: object.spaceId,
			state: Buffer.from(state),
			authorId,
		},
	});
}

// The single body-write path (ADR-0018): persist the folded Yjs update verbatim as the
// body's source of truth, then rebuild the Obj.snippet projection from it so the object
// kernel can search and preview the body without decoding the document on every read.
export async function storeDocument(
	objectId: string,
	state: Uint8Array,
	authorId: string | null = null,
) {
	await prisma.documentState.upsert({
		where: { objectId },
		create: { objectId, state: Buffer.from(state) },
		update: { state: Buffer.from(state) },
	});

	await prisma.obj.update({
		where: { id: objectId },
		data: { snippet: bodySnippetFromState(state) },
	});

	await syncBodyLinks(objectId, state);
	await captureVersion(objectId, state, authorId);
}

// The last authenticated writer per live document, captured at connect so the debounced
// Database.store (which does not itself receive the connection's session) can attribute the
// snapshot. Best-effort: a version written without a preceding connect records a null author.
const lastEditor = new Map<string, string>();

// The document name is the object id; the folded Yjs update binary is the body's
// source of truth (ADR-0018), so fetch/store read and write DocumentState verbatim.
export function createCollabServer(options: CollabOptions = {}) {
	return new Hocuspocus({
		name: "vanlife-collab",
		debounce: options.debounce ?? 2000,
		maxDebounce: options.maxDebounce ?? 4000,
		// Editing a body is a write: require a real Better Auth session and writer
		// membership on the object's space (ADR-0006). Direct (server-side)
		// connections bypass onConnect and are used by tests and internal callers.
		onConnect: async ({ requestHeaders, documentName }) => {
			const session = await auth.api
				.getSession({ headers: requestHeaders })
				.catch(() => null);

			if (!session?.user) {
				throw new Error("Collab connection requires a session.");
			}

			const object = await prisma.obj.findUnique({
				where: { id: documentName },
			});

			if (!object) {
				throw new Error("Collab document does not exist.");
			}

			await ensureSpaceAccess(session.user.id, object.spaceId, "writer");

			lastEditor.set(documentName, session.user.id);
		},
		extensions: [
			new Database({
				fetch: async ({ documentName }) => {
					const row = await prisma.documentState.findUnique({
						where: { objectId: documentName },
					});

					return row ? new Uint8Array(row.state) : null;
				},
				store: async ({ documentName, state }) => {
					await storeDocument(
						documentName,
						state,
						lastEditor.get(documentName) ?? null,
					);
				},
			}),
		],
	});
}
