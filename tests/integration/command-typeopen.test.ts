import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// Clicking a type in the rail opens the TYPE object itself at /main/set/<typeId>, and that screen
// draws only the root's dataview child: block/dataview.tsx returns null on an empty `views` array and
// logs "No sources" when the record carries no setOf type, so a type with neither came up as a header
// over an empty body — live, "Page" listed nothing although the space held page objects. A type is a
// set over its own objects, so opening one has to answer the same shape a set does, sourced by the
// type itself (the client resolves sources from the record's setOf, not from the block).
const DATAVIEW_BLOCK_ID = "dataview";

describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectOpen for a type screen",
	() => {
		const userId = "typeopen.owner";

		let spaceId = "";
		let typeId = "";
		let pageId = "";

		beforeAll(async () => {
			const stale = await prisma.space.findMany({
				where: { createdBy: userId },
				select: { id: true },
			});
			const staleIds = stale.map((it) => it.id);
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
					name: "Type open owner",
					email: "typeopen-owner@vanlife.test",
				},
			});

			signInAs(userId);
			spaceId = (
				await (
					await post("/api/command/WorkspaceCreate", {
						details: { name: "Type screen space" },
						useCase: 2,
					})
				).json()
			).spaceId as string;

			typeId = (
				await prisma.obj.findFirstOrThrow({
					where: { spaceId, resolvedLayout: "objectType", name: "Page" },
					select: { id: true },
				})
			).id;

			pageId = (
				await (
					await post("/api/command/ObjectCreate", {
						spaceId,
						objectTypeUniqueKey: "ot-page",
						details: { name: "A page of mine" },
					})
				).json()
			).objectId as string;
		});

		const open = async (objectId: string) => {
			signInAs(userId);
			const body = await (
				await post("/api/command/ObjectOpen", { spaceId, objectId })
			).json();
			expect(body.error).toEqual({ code: 0, description: "" });
			const view = body.objectView;
			return {
				view,
				root: view.blocks.find((it: any) => it.id === objectId),
				dataview: view.blocks.find((it: any) => it.id === DATAVIEW_BLOCK_ID),
			};
		};

		it("hands the type screen a dataview block and the type as its own source", async () => {
			const { view, root, dataview } = await open(typeId);

			expect(root.childrenIds).toContain(DATAVIEW_BLOCK_ID);
			expect(dataview).toBeDefined();
			expect(dataview.dataview.views.length).toBeGreaterThan(0);
			expect(dataview.dataview.activeView).not.toBe("");

			const details = view.details.find((it: any) => it.id === typeId).details;
			expect(details.setOf).toEqual([typeId]);
		});

		it("lists the type's objects through the screen's own query", async () => {
			await open(typeId);

			const body = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `${typeId}-${DATAVIEW_BLOCK_ID}`,
					source: [typeId],
					filters: [],
					sorts: [],
					keys: ["name", "resolvedLayout", "type"],
					offset: 0,
					limit: 500,
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			const ids = (body.records || []).map((it: any) => it.id);
			expect(ids).toContain(pageId);
			// The type's own row is not one of its members.
			expect(ids).not.toContain(typeId);
		});
	},
);
