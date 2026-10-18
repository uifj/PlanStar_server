import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// Anytype's I.ObjectLayout.Collection === 14. U.Object.isCollectionLayout keys off that
// number, so an object only behaves as a collection in the shell once its record
// carries layout 14. ObjectToCollection converts a plain object; the projection reads
// the persisted resolvedLayout through NUMERIC_LAYOUT.
const COLLECTION_LAYOUT = 14;

describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectToCollection",
	() => {
		const ownerId = "command-tocollection.owner";
		const outsiderId = "command-tocollection.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "ToCollection owner",
						email: "command-tocollection-owner@vanlife.test",
					},
					{
						id: outsiderId,
						name: "ToCollection outsider",
						email: "command-tocollection-outsider@vanlife.test",
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
					details: { name: "ToCollection space" },
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

		const layoutOf = async (spaceId: string, name: string) => {
			signInAs(ownerId);
			const body = await (
				await post("/api/command/ObjectSearch", {
					spaceId,
					filters: [],
					sorts: [],
					keys: [],
					fullText: name,
					offset: 0,
					limit: 10,
				})
			).json();
			const record = body.records.find((it: any) => it.name === name);
			return record?.layout;
		};

		it("converts an object so its record carries the collection layout", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Reading list");

			expect(await layoutOf(spaceId, "Reading list")).not.toBe(
				COLLECTION_LAYOUT,
			);

			signInAs(ownerId);
			const res = await (
				await post("/api/command/ObjectToCollection", { contextId: objectId })
			).json();
			expect(res.error).toEqual({ code: 0, description: "" });

			expect(await layoutOf(spaceId, "Reading list")).toBe(COLLECTION_LAYOUT);
		});

		// The shell routes a collection to the same screen as a set (U.Object.getSetLayouts), and that
		// screen draws only the root's dataview child: block/dataview.tsx returns null on an empty
		// views array. Converting an object therefore has to leave it something to draw, and the
		// screen's own request (ObjectSearchSubscribe with collectionId, which widget/view/index.tsx
		// sends in place of a source) has to answer the members that were added.
		it("opens a collection with a dataview that lists its members", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Film club");
			const first = await createObject(spaceId, "Stalker");
			const second = await createObject(spaceId, "Blade Runner");

			signInAs(ownerId);
			await post("/api/command/ObjectToCollection", { contextId: objectId });
			const added = await (
				await post("/api/command/ObjectCollectionAdd", {
					contextId: objectId,
					objectIds: [first, second],
				})
			).json();
			expect(added.error).toEqual({ code: 0, description: "" });

			const opened = await (
				await post("/api/command/ObjectOpen", { spaceId, objectId })
			).json();
			expect(opened.error).toEqual({ code: 0, description: "" });

			const root = opened.objectView.blocks.find(
				(it: any) => it.id === objectId,
			);
			const dataview = opened.objectView.blocks.find(
				(it: any) => it.id === "dataview",
			);
			expect(root.childrenIds).toContain("dataview");
			expect(dataview?.dataview?.views.length).toBeGreaterThan(0);
			// The screen's own gate: block/dataview.tsx recognises a collection only through the block
			// content (mapper.ts:278 reads TargetObjectId / isCollection), and loadData refuses to ask for
			// records at all when the block reports neither a target nor a sources list — which is why the
			// collection page came up as a Grid header over nothing.
			expect(dataview.dataview.isCollection).toBe(true);
			expect(dataview.dataview.TargetObjectId).toBe(objectId);

			const listed = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `${objectId}-dataview`,
					collectionId: objectId,
					filters: [],
					sorts: [],
					keys: ["name"],
					offset: 0,
					limit: 100,
				})
			).json();
			expect(listed.error).toEqual({ code: 0, description: "" });

			const ids = (listed.records || []).map((it: any) => it.id);
			expect(ids).toContain(first);
			expect(ids).toContain(second);
			// The collection lists its members, not itself.
			expect(ids).not.toContain(objectId);
		});

		it("answers NOT_FOUND for an object that does not exist", async () => {
			await createSpace();
			signInAs(ownerId);
			const res = await (
				await post("/api/command/ObjectToCollection", {
					contextId: "missing-object",
				})
			).json();
			expect(res.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("denies a caller who cannot write the space", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Guarded list");

			signInAs(outsiderId);
			const res = await post("/api/command/ObjectToCollection", {
				contextId: objectId,
			});
			expect((await res.json()).error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
