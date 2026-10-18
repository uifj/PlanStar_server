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

// The body persists over a real WebSocket, not the server's direct-connection API:
// the upgrade handler must forward socket messages into Hocuspocus' ClientConnection
// and hand it a WHATWG Request, or the client sits "connected" yet never syncs and
// nothing is stored. This drives the same path the browser provider uses.
describe.skipIf(!databaseAvailable)("collab websocket persistence", () => {
	const userId = "collab-ws.owner";
	let objectId = "";

	beforeAll(async () => {
		await prisma.user.create({
			data: {
				id: userId,
				name: "Collab WS owner",
				email: "collab-ws@vanlife.test",
			},
		});
		const space = await prisma.space.create({
			data: { name: "Collab WS space", createdBy: userId },
		});
		await prisma.spaceMember.create({
			data: { spaceId: space.id, userId, permission: "writer" },
		});
		const obj = await prisma.obj.create({
			data: {
				spaceId: space.id,
				name: "Body",
				resolvedLayout: "basic",
				creatorId: userId,
			},
		});
		objectId = obj.id;
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: userId } });
		await prisma.user.deleteMany({ where: { id: userId } });
	});

	it("syncs a real socket client and stores the folded Yjs state", async () => {
		signInAs(userId);

		const collab = createCollabServer({ debounce: 50, maxDebounce: 100 });
		const http = createServer();
		attachCollabUpgrade(http, collab);
		await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
		const { port } = http.address() as AddressInfo;

		const provider = new HocuspocusProvider({
			url: `ws://127.0.0.1:${port}/collab`,
			name: objectId,
			WebSocketPolyfill: NodeWebSocket as unknown as typeof WebSocket,
		});

		try {
			let synced = provider.isSynced;
			for (let i = 0; i < 60 && !synced; i++) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				synced = provider.isSynced;
			}
			expect(synced).toBe(true);

			provider.document.transact(() => {
				provider.document.getText("body").insert(0, "Hello over the socket");
			});

			let row = await prisma.documentState.findUnique({ where: { objectId } });
			for (let i = 0; i < 60 && !row; i++) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				row = await prisma.documentState.findUnique({ where: { objectId } });
			}
			expect(row).not.toBeNull();
			expect(row?.state.length).toBeGreaterThan(0);
		} finally {
			provider.destroy();
			await new Promise<void>((resolve) => http.close(() => resolve()));
		}

		// A fresh server must reload exactly the binary the socket client stored.
		const reopened = createCollabServer({ debounce: 50, maxDebounce: 100 });
		let text = "";
		const reopen = await reopened.openDirectConnection(objectId, { user: userId });
		await reopen.transact((doc) => {
			text = doc.getText("body").toString();
		});
		await reopen.disconnect();

		expect(text).toBe("Hello over the socket");
	}, 20000);
});
