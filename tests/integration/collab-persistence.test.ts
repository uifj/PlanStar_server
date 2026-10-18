import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { createCollabServer } from "../../src/modules/collab/server.js";
import { isDatabaseAvailable } from "./helpers/database.js";

const databaseAvailable = await isDatabaseAvailable();

// The collab server is the body's source of truth (ADR-0018): edits fold into a Yjs
// update binary that the database extension must persist per object, and a fresh
// server must reload exactly that binary. Exercised through the server's own
// direct-connection API so the extension's fetch/store hooks run untouched.
describe.skipIf(!databaseAvailable)("collab document persistence", () => {
	const userId = "collab.owner";
	let objectId = "";

	beforeAll(async () => {
		await prisma.user.create({
			data: {
				id: userId,
				name: "Collab owner",
				email: "collab@vanlife.test",
			},
		});
		const space = await prisma.space.create({
			data: { name: "Collab space", createdBy: userId },
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

	it("stores the folded Yjs state and reloads it on a fresh server", async () => {
		const server = createCollabServer({ debounce: 50, maxDebounce: 100 });

		const connection = await server.openDirectConnection(objectId, {
			user: userId,
		});
		await connection.transact((doc) => {
			doc.getText("body").insert(0, "Hello paragraph");
		});
		await connection.disconnect();

		// The debounced store hook flushes shortly after the last update.
		let row = await prisma.documentState.findUnique({ where: { objectId } });
		for (let i = 0; i < 40 && !row; i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			row = await prisma.documentState.findUnique({ where: { objectId } });
		}

		expect(row).not.toBeNull();
		expect(row?.state.length).toBeGreaterThan(0);

		const reopened = createCollabServer({ debounce: 50, maxDebounce: 100 });
		let text = "";
		const reopen = await reopened.openDirectConnection(objectId, {
			user: userId,
		});
		await reopen.transact((doc) => {
			text = doc.getText("body").toString();
		});
		await reopen.disconnect();

		expect(text).toBe("Hello paragraph");
	});
});
