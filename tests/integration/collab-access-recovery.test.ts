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

// Decode a persisted DocumentState binary back to body text, so a test can assert
// the marker actually reached the database rather than only living in memory.
const decodeStoredBody = async (objectId: string) => {
	const row = await prisma.documentState.findUnique({ where: { objectId } });
	if (!row) {
		return null;
	}
	const doc = new Y.Doc();
	Y.applyUpdate(doc, new Uint8Array(row.state));
	return doc.getText("body").toString();
};

// The collab socket resolves the editor from the Better Auth session cookie carried
// on the handshake (ADR-0006 write access). The mock reads that cookie so each
// provider can present a distinct identity, exactly as two browsers would.
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

// A Node WebSocket that carries the simulated session cookie on the upgrade request,
// standing in for the browser cookie the real provider sends.
function cookieSocket(cookie: string) {
	return class extends NodeWebSocket {
		constructor(url: string | URL) {
			super(url, { headers: cookie ? { cookie } : {} });
		}
	} as unknown as typeof WebSocket;
}

describe.skipIf(!databaseAvailable)("collab socket access", () => {
	const owner = "collab-access.owner";
	const writer = "collab-access.writer";
	const reader = "collab-access.reader";
	const outsider = "collab-access.outsider";
	let spaceId = "";
	let objectId = "";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [owner, writer, reader, outsider].map((id) => ({
				id,
				name: id,
				email: `${id}@vanlife.test`,
			})),
		});
		const space = await prisma.space.create({
			data: { name: "Collab access space", createdBy: owner },
		});
		spaceId = space.id;
		await prisma.spaceMember.createMany({
			data: [
				{ spaceId, userId: owner, permission: "owner" },
				{ spaceId, userId: writer, permission: "writer" },
				{ spaceId, userId: reader, permission: "reader" },
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
			where: { id: { in: [owner, writer, reader, outsider] } },
		});
	});

	const boot = async () => {
		const collab = createCollabServer({ debounce: 50, maxDebounce: 100 });
		const http = createServer();
		attachCollabUpgrade(http, collab);
		await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
		const { port } = http.address() as AddressInfo;
		return {
			port,
			collab,
			close: () => new Promise<void>((resolve) => http.close(() => resolve())),
		};
	};

	const connectAs = (port: number, userId: string | null) =>
		new HocuspocusProvider({
			url: `ws://127.0.0.1:${port}/collab`,
			name: objectId,
			WebSocketPolyfill: cookieSocket(sessionCookie(userId)),
		});

	// A rejected onConnect sends a permission-denied message: the provider fires
	// `authenticationFailed` and never reaches a synced, editable body.
	const observeRejection = async (provider: HocuspocusProvider) => {
		let denied: string | undefined;
		provider.on("authenticationFailed", ({ reason }: { reason: string }) => {
			denied = reason;
		});
		const fired = await waitFor(() => denied !== undefined, 40, 50);
		// Give a would-be sync every chance to arrive, so "never synced" is real.
		await new Promise((resolve) => setTimeout(resolve, 300));
		return { synced: provider.isSynced, denied: fired ? denied : undefined };
	};

	it("syncs two different writers on the same object live", async () => {
		const server = await boot();
		const a = connectAs(server.port, owner);
		const b = connectAs(server.port, writer);

		try {
			expect(await waitFor(() => a.isSynced)).toBe(true);
			expect(await waitFor(() => b.isSynced)).toBe(true);

			a.document.transact(() => {
				a.document.getText("body").insert(0, "from the owner");
			});

			const received = await waitFor(
				() => b.document.getText("body").toString() === "from the owner",
			);
			expect(received).toBe(true);
		} finally {
			a.destroy();
			b.destroy();
			await server.close();
		}
	}, 20000);

	it("rejects a connection with no session", async () => {
		const server = await boot();
		const anon = connectAs(server.port, null);

		try {
			const { synced, denied } = await observeRejection(anon);
			expect(synced).toBe(false);
			expect(denied).toBeDefined();
		} finally {
			anon.destroy();
			await server.close();
		}
	}, 20000);

	it("rejects a reader, because editing a body is a write", async () => {
		const server = await boot();
		const asReader = connectAs(server.port, reader);

		try {
			const { synced, denied } = await observeRejection(asReader);
			expect(synced).toBe(false);
			expect(denied).toBeDefined();
		} finally {
			asReader.destroy();
			await server.close();
		}
	}, 20000);

	it("rejects a signed-in user who is not a member of the space", async () => {
		const server = await boot();
		const asOutsider = connectAs(server.port, outsider);

		try {
			const { synced, denied } = await observeRejection(asOutsider);
			expect(synced).toBe(false);
			expect(denied).toBeDefined();
		} finally {
			asOutsider.destroy();
			await server.close();
		}
	}, 20000);

	it("restores the persisted body to a client after a full server restart", async () => {
		const marker = `restart-${Date.now()}`;
		const first = await boot();
		const author = connectAs(first.port, owner);

		try {
			expect(await waitFor(() => author.isSynced)).toBe(true);
			author.document.transact(() => {
				author.document.getText("body").insert(0, marker);
			});
			// Force the debounced store so durability is proven before the restart.
			await first.collab.flushPendingStores();

			let persisted: string | null = null;
			for (let i = 0; i < 40 && !(persisted?.includes(marker) ?? false); i++) {
				persisted = await decodeStoredBody(objectId);
				if (!(persisted?.includes(marker) ?? false)) {
					await new Promise((r) => setTimeout(r, 50));
				}
			}
			expect(persisted).toContain(marker);
		} finally {
			author.destroy();
			await first.close();
		}

		// A brand-new server process must reload exactly what was persisted.
		const second = await boot();
		const rejoined = connectAs(second.port, owner);
		try {
			expect(await waitFor(() => rejoined.isSynced)).toBe(true);
			const recovered = await waitFor(() =>
				rejoined.document.getText("body").toString().includes(marker),
			);
			expect(recovered).toBe(true);
		} finally {
			rejoined.destroy();
			await second.close();
		}
	}, 20000);

	it("restores the body to a client that reconnects after dropping", async () => {
		const marker = `reconnect-${Date.now()}`;
		const server = await boot();
		const author = connectAs(server.port, owner);

		try {
			expect(await waitFor(() => author.isSynced)).toBe(true);
			author.document.transact(() => {
				author.document.getText("body").insert(0, marker);
			});
			// The edit reaches the live server Document before the client drops.
			const seen = await waitFor(() =>
				author.document.getText("body").toString().includes(marker),
			);
			expect(seen).toBe(true);
			author.destroy();

			// A fresh client reconnects to the same still-running server.
			const rejoined = connectAs(server.port, owner);
			try {
				expect(await waitFor(() => rejoined.isSynced)).toBe(true);
				const recovered = await waitFor(() =>
					rejoined.document.getText("body").toString().includes(marker),
				);
				expect(recovered).toBe(true);
			} finally {
				rejoined.destroy();
			}
		} finally {
			author.destroy();
			await server.close();
		}
	}, 20000);
});
