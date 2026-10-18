import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { prisma } from "../../src/lib/prisma.js";
import { storeDocument } from "../../src/modules/collab/server.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// P4 global search: ObjectSearch(spaceId, fullText, ...) is the command-palette /
// search-popup read. It must match live objects by name or by the body snippet that
// the collab store path projects from the Yjs document (ADR-0018), and stay scoped to
// the caller's space.
describe.skipIf(!databaseAvailable)("POST /api/command/ObjectSearch", () => {
	const ownerId = "command-search.owner";
	const outsiderId = "command-search.outsider";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: ownerId,
					name: "Search owner",
					email: "command-search-owner@vanlife.test",
				},
				{
					id: outsiderId,
					name: "Search outsider",
					email: "command-search-outsider@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: ownerId } });
		await prisma.user.deleteMany({
			where: { id: { in: [ownerId, outsiderId] } },
		});
	});

	const createSpace = async () => {
		signInAs(ownerId);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Search space" },
				useCase: 2,
			})
		).json();
		return spaceId as string;
	};

	const createObject = async (spaceId: string, name: string) => {
		signInAs(ownerId);
		const { objectId } = await (
			await post("/api/command/ObjectCreate", {
				spaceId,
				details: { name },
			})
		).json();
		return objectId as string;
	};

	function bodyState(lines: string[]): Uint8Array {
		const doc = new Y.Doc();
		const fragment = doc.getXmlFragment("default");
		for (const line of lines) {
			const paragraph = new Y.XmlElement("paragraph");
			paragraph.insert(0, [new Y.XmlText(line)]);
			fragment.push([paragraph]);
		}
		return Y.encodeStateAsUpdate(doc);
	}

	const search = async (spaceId: string, fullText: string) => {
		signInAs(ownerId);
		const body = await (
			await post("/api/command/ObjectSearch", {
				spaceId,
				filters: [],
				sorts: [],
				keys: [],
				fullText,
				offset: 0,
				limit: 10,
			})
		).json();
		return body;
	};

	it("finds an object by name", async () => {
		const spaceId = await createSpace();
		await createObject(spaceId, "Zebra crossing");
		await createObject(spaceId, "Unrelated page");

		const body = await search(spaceId, "Zebra");
		expect(body.error).toEqual({ code: 0, description: "" });

		const names = body.records.map((it: any) => it.name);
		expect(names).toContain("Zebra crossing");
		expect(names).not.toContain("Unrelated page");
	});

	it("finds an object by its projected body snippet", async () => {
		const spaceId = await createSpace();
		const objectId = await createObject(spaceId, "Field notes");
		await storeDocument(
			objectId,
			bodyState(["A rare quokka was sighted here"]),
		);

		const body = await search(spaceId, "quokka");
		const names = body.records.map((it: any) => it.name);
		expect(names).toContain("Field notes");
	});

	it("excludes deleted objects", async () => {
		const spaceId = await createSpace();
		const objectId = await createObject(spaceId, "Doomed quoll");
		await createObject(spaceId, "Kept quoll");

		signInAs(ownerId);
		await post("/api/command/ObjectListDelete", {
			objectIds: [objectId],
		});

		const body = await search(spaceId, "quoll");
		const names = body.records.map((it: any) => it.name);
		expect(names).toContain("Kept quoll");
		expect(names).not.toContain("Doomed quoll");
	});

	it("denies a caller who cannot read the space", async () => {
		const spaceId = await createSpace();
		await createObject(spaceId, "Secret quokka");

		signInAs(outsiderId);
		const res = await post("/api/command/ObjectSearch", {
			spaceId,
			filters: [],
			sorts: [],
			keys: [],
			fullText: "quokka",
			offset: 0,
			limit: 10,
		});

		expect((await res.json()).error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
	});
});
