import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The set screen's own controls — the view list, the layout menu, the filter/sort/relation menus
// (component/block/dataview/controls.tsx, component/menu/dataview/*) — write through the
// BlockDataview* commands, and the shim answered none of them, so every edit was lost on reload.
// A view is stored as an object (ADR-0012) and echoed back through ObjectOpen's dataview block, so
// each command is asserted by reading the block again rather than by poking the row.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/BlockDataview* writes",
	() => {
		const userId = "dataviewwrite.owner";

		let spaceId = "";
		let pageTypeId = "";
		let setId = "";
		let viewId = "";

		const openDataview = async () => {
			signInAs(userId);
			const body = await (
				await post("/api/command/ObjectOpen", { spaceId, objectId: setId })
			).json();
			expect(body.error).toEqual({ code: 0, description: "" });
			const block = body.objectView.blocks.find(
				(it: any) => it.id === "dataview",
			);
			return block.dataview;
		};

		beforeAll(async () => {
			const stale = await prisma.space.findMany({
				where: { createdBy: userId },
				select: { id: true },
			});
			const staleIds = stale.map((it) => it.id);
			await prisma.link.deleteMany({ where: { spaceId: { in: staleIds } } });
			await prisma.obj.deleteMany({ where: { spaceId: { in: staleIds } } });
			await prisma.relation.deleteMany({
				where: { spaceId: { in: staleIds } },
			});
			await prisma.objectType.deleteMany({
				where: { spaceId: { in: staleIds } },
			});
			await prisma.spaceMember.deleteMany({ where: { userId } });
			await prisma.space.deleteMany({ where: { createdBy: userId } });
			await prisma.user.deleteMany({ where: { id: userId } });
			await prisma.user.create({
				data: {
					id: userId,
					name: "Dataview write owner",
					email: "dataviewwrite-owner@vanlife.test",
				},
			});

			signInAs(userId);
			spaceId = (
				await (
					await post("/api/command/WorkspaceCreate", {
						details: { name: "Dataview writes" },
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
			pageTypeId = types.records.find(
				(it: any) => it.uniqueKey === "ot-page",
			).id;

			const created = await (
				await post("/api/command/ObjectCreateSet", {
					spaceId,
					source: [pageTypeId],
					details: { name: "Writable set" },
				})
			).json();
			setId = created.objectId;

			const initial = await openDataview();
			viewId = initial.activeView;
		});

		it("keeps a created view and makes it the active one", async () => {
			signInAs(userId);
			const created = await (
				await post("/api/command/BlockDataviewViewCreate", {
					contextId: setId,
					blockId: "dataview",
					view: {
						id: "",
						name: "Gallery",
						type: 2,
						coverRelationKey: "cover",
						groupRelationKey: "",
						endRelationKey: "",
						wrapContent: true,
						listSize: 0,
						groupBackgroundColors: false,
						coverFit: false,
						cardSize: 0,
						hideIcon: false,
						pageLimit: 0,
						relations: [],
						filters: [],
						sorts: [],
						defaultTemplateId: "",
						defaultObjectTypeId: pageTypeId,
					},
					source: [pageTypeId],
				})
			).json();

			expect(created.error).toEqual({ code: 0, description: "" });
			expect(typeof created.viewId).toBe("string");
			expect(created.viewId).not.toBe("");

			const dataview = await openDataview();
			const names = dataview.views.map((it: any) => it.name);
			expect(names).toContain("Grid");
			expect(names).toContain("Gallery");
			expect(dataview.activeView).toBe(created.viewId);

			const gallery = dataview.views.find((it: any) => it.name === "Gallery");
			expect(gallery.id).toBe(created.viewId);
			expect(gallery.type).toBe(2);
			expect(gallery.coverRelationKey).toBe("cover");
		});

		it("switches the active view and remembers it", async () => {
			const dataview = await openDataview();
			const other = dataview.views.find((it: any) => it.id !== viewId);
			expect(other).toBeDefined();

			signInAs(userId);
			const switched = await (
				await post("/api/command/BlockDataviewViewSetActive", {
					contextId: setId,
					blockId: "dataview",
					viewId: other.id,
				})
			).json();
			expect(switched.error).toEqual({ code: 0, description: "" });

			expect((await openDataview()).activeView).toBe(other.id);

			// Switching back proves it is a write, not an append.
			await post("/api/command/BlockDataviewViewSetActive", {
				contextId: setId,
				blockId: "dataview",
				viewId,
			});
			expect((await openDataview()).activeView).toBe(viewId);
		});

		it("refuses a non-member writing the set's view", async () => {
			const outsider = "dataviewwrite.outsider";
			await prisma.user.deleteMany({ where: { id: outsider } });
			await prisma.user.create({
				data: {
					id: outsider,
					name: "Outsider",
					email: "dataviewwrite-out@vanlife.test",
				},
			});

			signInAs(outsider);
			const body = await (
				await post("/api/command/BlockDataviewViewSetActive", {
					contextId: setId,
					blockId: "dataview",
					viewId,
				})
			).json();

			expect(body.error.code).toBe(2);
		});

		// The filter, sort and column menus each send one element operation; the shell's dispatcher
		// replays it on its own copy of the view, so the answer has to carry both the stored element
		// and the operation the client's mapper reads (filter[]/sort[]/relation[]).
		it("keeps a filter, a sort and a column edit on the view", async () => {
			signInAs(userId);
			const created = await (
				await post("/api/command/BlockDataviewViewCreate", {
					contextId: setId,
					blockId: "dataview",
					view: {
						id: "",
						name: "Filtered",
						type: 0,
						relations: [],
						filters: [],
						sorts: [],
					},
					source: [pageTypeId],
				})
			).json();
			const target = created.viewId as string;

			const added = await (
				await post("/api/command/BlockDataviewFilterAdd", {
					contextId: setId,
					blockId: "dataview",
					viewId: target,
					filter: {
						id: "",
						RelationKey: "done",
						format: 9,
						condition: 1,
						operator: 0,
						quickOption: 0,
						value: { bool: true },
						includeTime: false,
						nestedFilters: [],
					},
				})
			).json();
			expect(added.error).toEqual({ code: 0, description: "" });
			expect(added.filterId).not.toBe("");
			expect(added.event.messages[0].blockDataviewViewUpdate).toMatchObject({
				id: "dataview",
				viewId: target,
				filter: [{ add: { items: [{ RelationKey: "done" }] } }],
			});

			await post("/api/command/BlockDataviewSortAdd", {
				contextId: setId,
				blockId: "dataview",
				viewId: target,
				sort: {
					id: "",
					RelationKey: "name",
					type: 1,
					customOrder: [],
					format: 0,
					includeTime: false,
					emptyPlacement: 0,
				},
			});
			await post("/api/command/BlockDataviewViewRelationReplace", {
				contextId: setId,
				blockId: "dataview",
				viewId: target,
				relationKey: "done",
				relation: {
					key: "done",
					isVisible: true,
					width: 240,
					formula: 0,
					align: 0,
				},
			});

			const dataview = await openDataview();
			const view = dataview.views.find((it: any) => it.id === target);
			expect(view.filters).toEqual([
				expect.objectContaining({
					id: added.filterId,
					RelationKey: "done",
					condition: 1,
					value: { bool: true },
				}),
			]);
			expect(view.sorts).toEqual([
				expect.objectContaining({ RelationKey: "name", type: 1 }),
			]);
			expect(view.relations).toEqual([
				expect.objectContaining({ key: "done", width: 240 }),
			]);

			// Dropping the filter is a write too: the same view comes back without it.
			await post("/api/command/BlockDataviewFilterRemove", {
				contextId: setId,
				blockId: "dataview",
				viewId: target,
				ids: [added.filterId],
			});
			const after = await openDataview();
			expect(after.views.find((it: any) => it.id === target).filters).toEqual(
				[],
			);
		});

		// The layout menu (menu/dataview/view/layout.tsx + settings.tsx) sends the whole view object
		// with its settings changed, so a gallery's cover and card size have to survive the round trip.
		it("keeps a view's layout settings and drops a deleted view", async () => {
			signInAs(userId);
			const created = await (
				await post("/api/command/BlockDataviewViewCreate", {
					contextId: setId,
					blockId: "dataview",
					view: {
						id: "",
						name: "Doomed",
						type: 2,
						relations: [],
						filters: [],
						sorts: [],
					},
					source: [pageTypeId],
				})
			).json();
			const doomed = created.viewId as string;

			const before = await openDataview();
			await post("/api/command/BlockDataviewViewUpdate", {
				contextId: setId,
				blockId: "dataview",
				viewId: doomed,
				view: {
					...before.views.find((it: any) => it.id === doomed),
					name: "Renamed gallery",
					coverRelationKey: "cover",
					cardSize: 2,
					hideIcon: true,
					wrapContent: false,
				},
			});

			const renamed = await openDataview();
			const view = renamed.views.find((it: any) => it.id === doomed);
			expect(view).toMatchObject({
				name: "Renamed gallery",
				type: 2,
				coverRelationKey: "cover",
				cardSize: 2,
				hideIcon: true,
				wrapContent: false,
			});

			const removed = await (
				await post("/api/command/BlockDataviewViewDelete", {
					contextId: setId,
					blockId: "dataview",
					viewId: doomed,
				})
			).json();
			expect(removed.error).toEqual({ code: 0, description: "" });

			const after = await openDataview();
			expect(after.views.map((it: any) => it.id)).not.toContain(doomed);
			expect(after.activeView).not.toBe(doomed);
			expect(
				await prisma.obj.findFirst({
					where: { id: doomed },
					select: { isDeleted: true },
				}),
			).toMatchObject({ isDeleted: true });
		});

		// RelationAdd/RelationSet own the block's relation links — the formats every view's columns
		// resolve from — and SetSource re-points the query at another type.
		it("keeps block-level relation links and sources", async () => {
			signInAs(userId);

			await prisma.relation.createMany({
				data: [
					{
						spaceId,
						uniqueKey: "roofMaterial",
						name: "Roof",
						format: "shortText",
					},
				],
			});

			const added = await (
				await post("/api/command/BlockDataviewRelationAdd", {
					contextId: setId,
					blockId: "dataview",
					relationKeys: ["roofMaterial"],
				})
			).json();
			expect(added.error).toEqual({ code: 0, description: "" });
			expect(added.event.messages[0].blockDataviewRelationSet).toMatchObject({
				id: "dataview",
			});

			const withLink = await openDataview();
			expect(
				withLink.relationLinks.find((it: any) => it.key === "roofMaterial"),
			).toMatchObject({ key: "roofMaterial", format: 1 });

			await post("/api/command/BlockDataviewRelationDelete", {
				contextId: setId,
				blockId: "dataview",
				relationKeys: ["roofMaterial"],
			});
			expect(
				(await openDataview()).relationLinks.map((it: any) => it.key),
			).not.toContain("roofMaterial");

			await post("/api/command/BlockDataviewSetSource", {
				contextId: setId,
				blockId: "dataview",
				source: [pageTypeId],
			});
			expect((await openDataview()).source).toEqual([pageTypeId]);
		});
	},
);
