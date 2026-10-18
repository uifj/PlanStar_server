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

	const searchWith = async (
		spaceId: string,
		filters: unknown[],
		fullText = "",
	) => {
		signInAs(ownerId);
		return (
			await post("/api/command/ObjectSearch", {
				spaceId,
				filters,
				sorts: [],
				keys: [],
				fullText,
				offset: 0,
				limit: 20,
			})
		).json();
	};

	// The pickers ("add link to", relation value, template target) list objects by FILTER with no
	// query typed, which is the same command — an empty fullText is not "search for nothing".
	it("lists the space's objects when no text is typed", async () => {
		const spaceId = await createSpace();
		await createObject(spaceId, "Alpha index");
		await createObject(spaceId, "Beta index");

		const body = await searchWith(spaceId, []);
		expect(body.error).toEqual({ code: 0, description: "" });

		const names = body.records.map((it: any) => it.name);
		expect(names).toContain("Alpha index");
		expect(names).toContain("Beta index");
	});

	it("narrows a text-less search by its filters", async () => {
		const spaceId = await createSpace();
		await createObject(spaceId, "Alpha index");
		await createObject(spaceId, "Beta index");

		const body = await searchWith(spaceId, [
			{ RelationKey: "name", condition: 1, value: "Alpha index" },
		]);
		expect(body.records.map((it: any) => it.name)).toEqual(["Alpha index"]);
	});

	const createTyped = async (
		spaceId: string,
		uniqueKey: string,
		name: string,
	) => {
		signInAs(ownerId);
		return (
			await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					objectTypeUniqueKey: uniqueKey,
					details: { name },
				})
			).json()
		).objectId as string;
	};

	// The highlighted sibling of ObjectSearch takes the same filters, plus a query it cannot do
	// without — the text and the nested type filter have to narrow together.
	const searchWithMeta = async (spaceId: string, filters: unknown[]) => {
		signInAs(ownerId);
		return (
			await post("/api/command/ObjectSearchWithMeta", {
				spaceId,
				filters,
				sorts: [],
				keys: [],
				fullText: "index",
				offset: 0,
				limit: 20,
			})
		).json();
	};

	// U.Data.countTemplatesByTypeId (lib/util/data.ts:756) asks a type how many templates it owns
	// with a `type.uniqueKey` filter, and the template rail filters the same way. That key is nested —
	// an object's typeId points at an ObjectType row — so the flat filter compiler drops it and the
	// search answers with every visible object in the space. The subscriptions resolve it through
	// typeUniqueKeyClause; a search that skips it cannot narrow, and live it returned ot-page objects
	// for a query that asked for ot-template.
	it("resolves a type.uniqueKey filter", async () => {
		const spaceId = await createSpace();
		const pageId = await createTyped(spaceId, "ot-page", "Alpha index");
		const taskId = await createTyped(spaceId, "ot-task", "Beta index");

		const pages = await searchWith(spaceId, [
			{ RelationKey: "type.uniqueKey", condition: 1, value: "ot-page" },
		]);
		const pageIds = pages.records.map((it: any) => it.id);
		expect(pageIds).toContain(pageId);
		expect(pageIds).not.toContain(taskId);

		const highlighted = await searchWithMeta(spaceId, [
			{ RelationKey: "type.uniqueKey", condition: 1, value: "ot-page" },
		]);
		const metaIds = highlighted.results.map((it: any) => it.details.id);
		expect(metaIds).toContain(pageId);
		expect(metaIds).not.toContain(taskId);
	});

	it("applies the filter and the text together", async () => {
		const spaceId = await createSpace();
		await createObject(spaceId, "Alpha index");
		await createObject(spaceId, "Beta index");

		const matched = await searchWith(
			spaceId,
			[{ RelationKey: "name", condition: 1, value: "Alpha index" }],
			"Alpha",
		);
		expect(matched.records.map((it: any) => it.name)).toEqual(["Alpha index"]);

		const crossed = await searchWith(
			spaceId,
			[{ RelationKey: "name", condition: 1, value: "Alpha index" }],
			"Beta",
		);
		expect(crossed.records).toEqual([]);
	});

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
