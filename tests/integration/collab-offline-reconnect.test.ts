import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket as NodeWebSocket } from "ws";
import * as Y from "yjs";
import { auth } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/prisma.js";
import { createCollabServer } from "../../src/modules/collab/server.js";
import { attachCollabUpgrade } from "../../src/modules/collab/upgrade.js";
import { isDatabaseAvailable } from "./helpers/database.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

const waitFor = async (
	predicate: () => boolean,
	attempts = 60,
	stepMs = 50,
) => {
	let ok = predicate();
	for (let i = 0; i < attempts && !ok; i++) {
		await new Promise((resolve) => setTimeout(resolve, stepMs));
		ok = predicate();
	}
	return ok;
};

// Decode a persisted DocumentState binary back to body text, so a test can assert the merged body
// actually reached the database rather than only living in the two clients' memory.
const decodeStoredBody = async (objectId: string) => {
	const row = await prisma.documentState.findUnique({ where: { objectId } });
	if (!row) {
		return null;
	}
	const doc = new Y.Doc();
	Y.applyUpdate(doc, new Uint8Array(row.state));
	return doc.getText("body").toString();
};

const sessionCookie = (userId: string | null) =>
	userId ? `collab_user=${userId}` : "";

function mockSessionByCookie() {
	vi.mocked(auth.api.getSession).mockImplementation((async ({
		headers,
	}: any) => {
		const cookie = headers?.get?.("cookie") ?? "";
		const match = /collab_user=([^;]+)/.exec(cookie);
		const userId = match?.[1];
		if (!userId) {
			return null;
		}
		return {
			session: { id: `session-${userId}`, userId },
			user: { id: userId, email: `${userId}@vanlife.test`, role: null },
		};
	}) as never);
}

function cookieSocket(cookie: string) {
	return class extends NodeWebSocket {
		constructor(url: string | URL) {
			super(url, { headers: cookie ? { cookie } : {} });
		}
	} as unknown as typeof WebSocket;
}

// P6 文档离线隔离和重连 (offline isolation + reconnection). The reconnect-after-drop and restart-
// recovery paths (collab-access-recovery.test.ts) prove a client regains the SERVER state; this proves
// the other half of the durability contract: a client that keeps editing its own Y.Doc while the socket
// is down stays ISOLATED (its offline edits do not leak to the server or another client), and on
// reconnect those edits MERGE with whatever happened on the server in the meantime (Yjs CRDT) and the
// merged body is what persists. This is the single-write-path guarantee of ADR-0018 under a partition.
describe.skipIf(!databaseAvailable)(
	"collab offline isolation and reconnection",
	() => {
		const owner = "collab-offline.owner";
		const writer = "collab-offline.writer";
		let spaceId = "";
		let objectId = "";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [owner, writer].map((id) => ({
					id,
					name: id,
					email: `${id}@vanlife.test`,
				})),
			});
			const space = await prisma.space.create({
				data: { name: "Collab offline space", createdBy: owner },
			});
			spaceId = space.id;
			await prisma.spaceMember.createMany({
				data: [
					{ spaceId, userId: owner, permission: "owner" },
					{ spaceId, userId: writer, permission: "writer" },
				],
			});
			const obj = await prisma.obj.create({
				data: {
					spaceId,
					name: "Body",
					resolvedLayout: "basic",
					creatorId: owner,
				},
			});
			objectId = obj.id;
			mockSessionByCookie();
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({
				where: { id: { in: [owner, writer] } },
			});
		});

		const boot = async () => {
			const collab = createCollabServer({ debounce: 50, maxDebounce: 100 });
			const http = createServer();
			attachCollabUpgrade(http, collab);
			await new Promise<void>((resolve) =>
				http.listen(0, "127.0.0.1", resolve),
			);
			const { port } = http.address() as AddressInfo;
			return {
				port,
				collab,
				close: () =>
					new Promise<void>((resolve) => http.close(() => resolve())),
			};
		};

		// A provider bound to a caller-supplied Y.Doc, so the doc (and its offline edits) survives a
		// disconnect()/connect() cycle exactly as a backgrounded browser tab keeps its editor state.
		const connectWithDoc = (port: number, userId: string, doc: Y.Doc) =>
			new HocuspocusProvider({
				url: `ws://127.0.0.1:${port}/collab`,
				name: objectId,
				document: doc,
				WebSocketPolyfill: cookieSocket(sessionCookie(userId)),
			});

		const connectAs = (port: number, userId: string) =>
			new HocuspocusProvider({
				url: `ws://127.0.0.1:${port}/collab`,
				name: objectId,
				WebSocketPolyfill: cookieSocket(sessionCookie(userId)),
			});

		it("isolates a disconnected client's edits, then merges and persists them on reconnect", async () => {
			const server = await boot();
			const aDoc = new Y.Doc();
			const a = connectWithDoc(server.port, owner, aDoc);

			try {
				expect(await waitFor(() => a.isSynced)).toBe(true);

				// A writes while online; the edit lands on the server Document and is forced to persist so
				// the pre-partition state is durable before A drops.
				aDoc.transact(() => aDoc.getText("body").insert(0, "[online-A]"));
				expect(
					await waitFor(() =>
						aDoc.getText("body").toString().includes("[online-A]"),
					),
				).toBe(true);
				await server.collab.flushPendingStores();

				// A goes OFFLINE but keeps its document (disconnect, not destroy).
				a.disconnect();
				expect(await waitFor(() => !a.isSynced)).toBe(true);

				// While A is offline, B connects and writes to the server.
				const b = connectAs(server.port, writer);
				try {
					expect(await waitFor(() => b.isSynced)).toBe(true);
					b.document.transact(() =>
						b.document.getText("body").insert(0, "[B]"),
					);
					expect(
						await waitFor(() =>
							b.document.getText("body").toString().includes("[B]"),
						),
					).toBe(true);

					// A edits its LOCAL doc while offline. Isolation: B must not see it while A is down.
					aDoc.transact(() => aDoc.getText("body").insert(0, "[offline-A]"));
					await new Promise((resolve) => setTimeout(resolve, 250));
					expect(
						b.document.getText("body").toString().includes("[offline-A]"),
					).toBe(false);

					// A reconnects: the sync protocol exchanges state vectors and Yjs merges both sides.
					await a.connect();
					expect(await waitFor(() => a.isSynced)).toBe(true);

					const aMerged = await waitFor(() => {
						const t = aDoc.getText("body").toString();
						return (
							t.includes("[online-A]") &&
							t.includes("[B]") &&
							t.includes("[offline-A]")
						);
					});
					expect(aMerged).toBe(true);

					// B converges to the same merged body without reconnecting.
					const bMerged = await waitFor(() => {
						const t = b.document.getText("body").toString();
						return (
							t.includes("[online-A]") &&
							t.includes("[B]") &&
							t.includes("[offline-A]")
						);
					});
					expect(bMerged).toBe(true);

					// The merged body is what persists, proving storeDocument wrote the folded CRDT state.
					await server.collab.flushPendingStores();
					let persisted: string | null = null;
					for (let i = 0; i < 40; i++) {
						persisted = await decodeStoredBody(objectId);
						if (
							(persisted?.includes("[online-A]") ?? false) &&
							(persisted?.includes("[B]") ?? false) &&
							(persisted?.includes("[offline-A]") ?? false)
						) {
							break;
						}
						await new Promise((resolve) => setTimeout(resolve, 50));
					}
					expect(persisted).toContain("[online-A]");
					expect(persisted).toContain("[B]");
					expect(persisted).toContain("[offline-A]");
				} finally {
					b.destroy();
				}
			} finally {
				a.destroy();
				await server.close();
			}
		}, 30000);
	},
);
