import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { WebSocket as NodeWebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { createCollabServer } from "../../src/modules/collab/server.js";
import { attachCollabUpgrade } from "../../src/modules/collab/upgrade.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

const waitFor = async (predicate: () => boolean, attempts = 60, stepMs = 50) => {
	let ok = predicate();
	for (let i = 0; i < attempts && !ok; i++) {
		await new Promise((resolve) => setTimeout(resolve, stepMs));
		ok = predicate();
	}
	return ok;
};

// Two-end sync (P1 双端同步): a body edit made by one connected client must reach
// another client on the same object live, through the collab socket and the single
// server-side Yjs Document. This drives the same broadcast path two browsers use.
describe.skipIf(!databaseAvailable)("collab two-end live sync", () => {
	const userId = "collab-live.owner";
	let spaceId = "";

	beforeAll(async () => {
		await prisma.user.create({
			data: {
				id: userId,
				name: "Collab live owner",
				email: "collab-live@vanlife.test",
			},
		});
		const space = await prisma.space.create({
			data: { name: "Collab live space", createdBy: userId },
		});
		spaceId = space.id;
		await prisma.spaceMember.create({
			data: { spaceId, userId, permission: "writer" },
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: userId } });
		await prisma.user.deleteMany({ where: { id: userId } });
	});

	// Each behaviour owns a fresh object so its persisted Yjs state starts empty.
	const newObject = async () => {
		const obj = await prisma.obj.create({
			data: {
				spaceId,
				name: "Body",
				resolvedLayout: "basic",
				creatorId: userId,
			},
		});
		return obj.id;
	};

	const boot = async () => {
		const collab = createCollabServer({ debounce: 50, maxDebounce: 100 });
		const http = createServer();
		attachCollabUpgrade(http, collab);
		await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
		const { port } = http.address() as AddressInfo;
		return {
			port,
			close: () => new Promise<void>((resolve) => http.close(() => resolve())),
		};
	};

	const connect = (port: number, objectId: string) =>
		new HocuspocusProvider({
			url: `ws://127.0.0.1:${port}/collab`,
			name: objectId,
			WebSocketPolyfill: NodeWebSocket as unknown as typeof WebSocket,
		});

	it("delivers one client's body edit to another client live", async () => {
		signInAs(userId);
		const objectId = await newObject();
		const server = await boot();

		const a = connect(server.port, objectId);
		const b = connect(server.port, objectId);

		try {
			expect(await waitFor(() => a.isSynced)).toBe(true);
			expect(await waitFor(() => b.isSynced)).toBe(true);

			a.document.transact(() => {
				a.document.getText("body").insert(0, "typed by A");
			});

			const received = await waitFor(
				() => b.document.getText("body").toString() === "typed by A",
			);
			expect(received).toBe(true);
		} finally {
			a.destroy();
			b.destroy();
			await server.close();
		}
	}, 20000);

	it("seeds a client that joins after the body was already edited", async () => {
		signInAs(userId);
		const objectId = await newObject();
		const server = await boot();

		const a = connect(server.port, objectId);
		let late: HocuspocusProvider | undefined;

		try {
			expect(await waitFor(() => a.isSynced)).toBe(true);
			a.document.transact(() => {
				a.document.getText("body").insert(0, "written before B arrived");
			});

			// B joins only after A's edit has landed on the server Document.
			late = connect(server.port, objectId);
			expect(await waitFor(() => late.isSynced)).toBe(true);

			const seeded = await waitFor(
				() =>
					late?.document.getText("body").toString() ===
					"written before B arrived",
			);
			expect(seeded).toBe(true);
		} finally {
			a.destroy();
			late?.destroy();
			await server.close();
		}
	}, 20000);

	it("converges concurrent edits from both clients to the same body", async () => {
		signInAs(userId);
		const objectId = await newObject();
		const server = await boot();

		const a = connect(server.port, objectId);
		const b = connect(server.port, objectId);

		try {
			expect(await waitFor(() => a.isSynced)).toBe(true);
			expect(await waitFor(() => b.isSynced)).toBe(true);

			// Both clients insert at the same position without waiting for each other.
			a.document.transact(() => {
				a.document.getText("body").insert(0, "[A]");
			});
			b.document.transact(() => {
				b.document.getText("body").insert(0, "[B]");
			});

			// Yjs merges deterministically by client id, so the order is not fixed;
			// what must hold is that both ends agree and keep both edits.
			const converged = await waitFor(() => {
				const left = a.document.getText("body").toString();
				const right = b.document.getText("body").toString();
				return (
					left === right && left.includes("[A]") && left.includes("[B]")
				);
			});
			expect(converged).toBe(true);
		} finally {
			a.destroy();
			b.destroy();
			await server.close();
		}
	}, 20000);
});
