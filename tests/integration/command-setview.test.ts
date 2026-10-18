import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The set screen (component/page/main/set.tsx:248) draws only the root block's children that
// `isDataview()`, and the block type is detected from the wire key (`dataview`, mapper.ts:17-35),
// so the block id has to be the client's constant "dataview" (json/constant.ts:210). With no such
// child the screen renders a title and nothing else, and with an empty `views` array the dataview
// component returns null outright (block/dataview.tsx:1673). The member query then runs against
// subId `<setId>-dataview` with the set's `setOf` type ids as source.
const DATAVIEW_BLOCK_ID = "dataview";
const VIEW_TYPE_GRID = 0;

describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectOpen for a set",
	() => {
		const userId = "command-setview.owner";

		let spaceId = "";
		let pageTypeId = "";
		const memberIds: string[] = [];

		beforeAll(async () => {
			const stale = await prisma.space.findMany({
				where: { createdBy: userId },
				select: { id: true },
			});
			const staleIds = stale.map((it) => it.id);
			await prisma.link.deleteMany({ where: { spaceId: { in: staleIds } } });
			await prisma.obj.deleteMany({ where: { spaceId: { in: staleIds } } });
			await prisma.objectType.deleteMany({
				where: { spaceId: { in: staleIds } },
			});
			await prisma.spaceMember.deleteMany({ where: { userId } });
			await prisma.space.deleteMany({ where: { createdBy: userId } });
			await prisma.user.deleteMany({ where: { id: userId } });
			await prisma.user.create({
				data: {
					id: userId,
					name: "Set view owner",
					email: "command-setview-owner@vanlife.test",
				},
			});

			signInAs(userId);
			spaceId = (
				await (
					await post("/api/command/WorkspaceCreate", {
						details: { name: "Set view space" },
						useCase: 2,
					})
				).json()
			).spaceId as string;

			const types = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `type-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
					offset: 0,
					limit: 50,
				})
			).json();
			pageTypeId = types.records.find((it: any) => it.uniqueKey === "ot-page")
				.id as string;

			for (const name of ["Lofoten", "Sognefjord"]) {
				const created = await (
					await post("/api/command/ObjectCreate", {
						spaceId,
						objectTypeUniqueKey: "ot-page",
						details: { name },
					})
				).json();
				memberIds.push(created.objectId as string);
			}
		});

		const openSet = async (objectId: string) => {
			signInAs(userId);
			const body = await (
				await post("/api/command/ObjectOpen", { spaceId, objectId })
			).json();
			expect(body.error).toEqual({ code: 0, description: "" });

			const view = body.objectView;
			const root = view.blocks.find((it: any) => it.id === objectId);
			const dataview = view.blocks.find(
				(it: any) => it.id === DATAVIEW_BLOCK_ID,
			);
			return { view, root, dataview };
		};

		it("hands the set screen a dataview block carrying its grid view", async () => {
			const created = await (
				await post("/api/command/ObjectCreateSet", {
					spaceId,
					source: [pageTypeId],
					details: { name: "Norway stops" },
				})
			).json();
			expect(created.error).toEqual({ code: 0, description: "" });

			const { root, view, dataview } = await openSet(created.objectId);

			expect(root.childrenIds).toContain(DATAVIEW_BLOCK_ID);
			expect(dataview).toBeDefined();
			expect(dataview.dataview.activeView).not.toBe("");

			const views = dataview.dataview.views;
			expect(views).toHaveLength(1);
			expect(views[0].id).toBe(dataview.dataview.activeView);
			expect(views[0].type).toBe(VIEW_TYPE_GRID);
			expect(views[0].name).not.toBe("");

			// The client resolves the query's sources from the record's setOf, not the block.
			const details = view.details.find(
				(it: any) => it.id === created.objectId,
			).details;
			expect(details.setOf).toEqual([pageTypeId]);
			expect(details.layout).toBe(3);
		});

		it("lists the set's members through the dataview subscription", async () => {
			const created = await (
				await post("/api/command/ObjectCreateSet", {
					spaceId,
					source: [pageTypeId],
					details: { name: "Member query" },
				})
			).json();
			const { dataview } = await openSet(created.objectId);

			const body = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `${created.objectId}-${DATAVIEW_BLOCK_ID}`,
					source: [pageTypeId],
					filters: [
						{
							RelationKey: "resolvedLayout",
							format: 2,
							condition: 10,
							value: [13, 18, 10, 27],
						},
					],
					sorts: [
						{
							RelationKey: "createdDate",
							type: 1,
							format: 4,
							includeTime: true,
						},
					],
					keys: ["name", "resolvedLayout", "type"],
					offset: 0,
					limit: 500,
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(dataview.dataview.views[0].sorts.length).toBeGreaterThan(0);

			const ids = (body.records || []).map((it: any) => it.id);
			for (const member of memberIds) expect(ids).toContain(member);
			expect(ids).not.toContain(created.objectId);
		});

		it("sorts its default view by a relation the client can echo back", async () => {
			// The client sends the view's sorts verbatim, so a kernel column name would come
			// back as an unknown relation on the very next read.
			const created = await (
				await post("/api/command/ObjectCreateSet", {
					spaceId,
					source: [pageTypeId],
					details: { name: "Sorted view" },
				})
			).json();
			const { dataview } = await openSet(created.objectId);
			const sort = dataview.dataview.views[0].sorts[0];

			expect(sort.RelationKey).toBe("createdDate");

			const body = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `${created.objectId}-dataview`,
					source: [pageTypeId],
					filters: [],
					sorts: [
						{
							RelationKey: sort.RelationKey,
							type: sort.type,
							format: 4,
							includeTime: true,
						},
					],
					keys: ["name"],
					offset: 0,
					limit: 100,
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect((body.records || []).length).toBeGreaterThan(0);
		});

		it("gives a converted object the same dataview block", async () => {
			const page = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					objectTypeUniqueKey: "ot-page",
					details: { name: "Converted into a set" },
				})
			).json();

			const converted = await (
				await post("/api/command/ObjectToSet", {
					contextId: page.objectId,
					source: [pageTypeId],
				})
			).json();
			expect(converted.error).toEqual({ code: 0, description: "" });

			const { root, dataview } = await openSet(page.objectId);
			expect(root.childrenIds).toContain(DATAVIEW_BLOCK_ID);
			expect(dataview.dataview.views).toHaveLength(1);
		});
	},
);
