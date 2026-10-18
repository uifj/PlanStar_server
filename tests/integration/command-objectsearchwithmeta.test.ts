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

// The global search popup (popup/search.tsx:2755) reads through ObjectSearchWithMeta, not
// ObjectSearch: same request, but the response mapper (mapper.ts:529) spreads each result's
// `details` and attaches `metaList` from `meta`, so the row renderer can highlight where the
// query matched. The backend answers `results: [{ details, meta }]` with honest highlight
// ranges computed from the name-or-snippet match (ADR-0018 body projection).
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectSearchWithMeta",
	() => {
		const ownerId = "searchmeta.owner";
		const outsiderId = "searchmeta.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Meta owner",
						email: "searchmeta-owner@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Meta outsider",
						email: "searchmeta-outsider@vanlife.test",
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
					details: { name: "Meta space" },
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
			return (
				await post("/api/command/ObjectSearchWithMeta", {
					spaceId,
					filters: [],
					sorts: [],
					keys: [],
					fullText,
					offset: 0,
					limit: 10,
				})
			).json();
		};

		it("returns matched objects as results with their details", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Zebra crossing");
			await createObject(spaceId, "Unrelated page");

			const body = await search(spaceId, "Zebra");
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(Array.isArray(body.results)).toBe(true);

			const hit = body.results.find((r: any) => r.details?.id === objectId);
			expect(hit).toBeDefined();
			expect(hit.details.name).toBe("Zebra crossing");
			// The unrelated object must not surface for this query.
			expect(
				body.results.some((r: any) => r.details?.name === "Unrelated page"),
			).toBe(false);
		});

		// The global search bar attaches a creator/type token as filters alongside the query; the
		// highlights are computed from the text, but the filter still has to narrow the result set.
		it("honours its filters alongside the text", async () => {
			const spaceId = await createSpace();
			await createObject(spaceId, "Zebra crossing");
			await createObject(spaceId, "Zebra stripes");

			signInAs(ownerId);
			const body = await (
				await post("/api/command/ObjectSearchWithMeta", {
					spaceId,
					filters: [
						{ RelationKey: "name", condition: 1, value: "Zebra crossing" },
					],
					sorts: [],
					keys: [],
					fullText: "Zebra",
					offset: 0,
					limit: 10,
				})
			).json();

			expect(body.results.map((r: any) => r.details.name).sort()).toEqual([
				"Zebra crossing",
			]);
		});

		it("highlights the matched range in the name", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Zebra crossing");

			const body = await search(spaceId, "Zebra");
			const hit = body.results.find((r: any) => r.details?.id === objectId);
			const nameMeta = hit.meta.find((m: any) => m.relationKey === "name");

			expect(nameMeta).toBeDefined();
			expect(nameMeta.highlight).toBe("Zebra crossing");
			// "Zebra" occupies indices 0..5 of the name.
			expect(nameMeta.highlightRanges).toEqual([{ from: 0, to: 5 }]);
		});

		it("highlights a body-snippet match under the description relation", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Field notes");
			await storeDocument(
				objectId,
				bodyState(["A rare quokka was sighted here"]),
			);

			const body = await search(spaceId, "quokka");
			const hit = body.results.find((r: any) => r.details?.id === objectId);
			expect(hit).toBeDefined();

			const bodyMeta = hit.meta.find(
				(m: any) => m.relationKey === "description",
			);
			expect(bodyMeta).toBeDefined();
			// The snippet is the projected body line; "quokka" starts at index 7.
			expect(bodyMeta.highlight).toBe("A rare quokka was sighted here");
			expect(bodyMeta.highlightRanges).toEqual([{ from: 7, to: 13 }]);
		});

		it("denies a caller who cannot read the space", async () => {
			const spaceId = await createSpace();
			await createObject(spaceId, "Secret quokka");

			signInAs(outsiderId);
			const res = await post("/api/command/ObjectSearchWithMeta", {
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

		it("requires a spaceId", async () => {
			signInAs(ownerId);
			const res = await post("/api/command/ObjectSearchWithMeta", {
				spaceId: "",
				filters: [],
				sorts: [],
				keys: [],
				fullText: "anything",
				offset: 0,
				limit: 10,
			});

			expect((await res.json()).error).toEqual({
				code: 3,
				description: "Object not found.",
			});
		});

		it("returns no results for an empty query", async () => {
			const spaceId = await createSpace();
			await createObject(spaceId, "Some page");

			const body = await search(spaceId, "   ");
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.results).toEqual([]);
		});
	},
);
