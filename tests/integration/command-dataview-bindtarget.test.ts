import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// A dataview inside a page body shows an existing set or collection: the block's source picker
// (component/block/dataview.tsx:969, component/block/dataview/head.tsx:121) picks the object, sends
// BlockDataviewCreateFromExistingObject, and then loads the FIRST view of the answer
// (`message.views[0].id`), because response.ts:517 maps the response's `view` array onto `views`.
// The shim answered none of it, so an inline block never got a view to render and stayed a frame
// around nothing. The binding itself lives in the block's Yjs attrs (ADR-0018) — what this command
// owes the client is the target's views.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/BlockDataviewCreateFromExistingObject",
	() => {
		const ownerId = "bindtarget.owner";
		const readerId = "bindtarget.reader";

		let spaceId = "";
		let pageId = "";

		const bind = async (
			targetObjectId: string,
			blockId = "dv-inline",
			as = ownerId,
		) => {
			signInAs(as);
			return (
				await post("/api/command/BlockDataviewCreateFromExistingObject", {
					contextId: pageId,
					blockId,
					targetObjectId,
					spaceId,
				})
			).json();
		};

		const createSet = async (name: string) => {
			signInAs(ownerId);
			return (
				await (
					await post("/api/command/ObjectCreateSet", {
						spaceId,
						details: { name },
						setOf: [],
					})
				).json()
			).objectId as string;
		};

		const createCollection = async (name: string) => {
			signInAs(ownerId);
			const created = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					objectTypeUniqueKey: "ot-collection",
					details: [{ key: "name", value: name }],
				})
			).json();
			await post("/api/command/ObjectToCollection", {
				contextId: created.objectId,
			});
			return created.objectId as string;
		};

		beforeAll(async () => {
			const stale = await prisma.space.findMany({
				where: { createdBy: ownerId },
				select: { id: true },
			});
			const staleIds = stale.map((it) => it.id);
			await prisma.link.deleteMany({ where: { spaceId: { in: staleIds } } });
			await prisma.obj.deleteMany({ where: { spaceId: { in: staleIds } } });
			await prisma.objectType.deleteMany({
				where: { spaceId: { in: staleIds } },
			});
			await prisma.spaceMember.deleteMany({
				where: { userId: { in: [ownerId, readerId] } },
			});
			await prisma.space.deleteMany({ where: { createdBy: ownerId } });
			await prisma.user.deleteMany({
				where: { id: { in: [ownerId, readerId] } },
			});
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Bind target owner",
						email: "bindtarget-owner@vanlife.test",
					},
					{
						id: readerId,
						name: "Bind target reader",
						email: "bindtarget-reader@vanlife.test",
					},
				],
			});

			signInAs(ownerId);
			spaceId = (
				await (
					await post("/api/command/WorkspaceCreate", {
						details: { name: "Bind target space" },
						useCase: 2,
					})
				).json()
			).spaceId as string;

			pageId = (
				await (
					await post("/api/command/ObjectCreate", {
						spaceId,
						objectTypeUniqueKey: "ot-page",
						details: { name: "The hosting page" },
					})
				).json()
			).objectId as string;

			await prisma.spaceMember.create({
				data: {
					spaceId,
					userId: readerId,
					permission: "reader",
					status: "active",
				},
			});
		});

		it("answers the bound set's views so the block has one to load", async () => {
			const setId = await createSet("Trip shortlist");

			const body = await bind(setId);

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.blockId).toBe("dv-inline");
			expect(body.targetObjectId).toBe(setId);
			expect(Array.isArray(body.view)).toBe(true);
			expect(body.view.length).toBeGreaterThan(0);
			// The client loads views[0], so that id has to be the one the target itself reports.
			const opened = await (
				await post("/api/command/ObjectOpen", { spaceId, objectId: setId })
			).json();
			const block = opened.objectView.blocks.find(
				(it: any) => it.id === "dataview",
			);
			expect(body.view[0].id).toBe(block.dataview.activeView);
		});

		// A collection is bound the same way (head.tsx:121 mints one and binds it at once).
		it("answers a bound collection's views", async () => {
			const collectionId = await createCollection("Reading list");

			const body = await bind(collectionId, "dv-collection");

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.targetObjectId).toBe(collectionId);
			expect(body.view.length).toBeGreaterThan(0);
		});

		it("refuses a caller who cannot write the space", async () => {
			const setId = await createSet("Owner's shortlist");

			const body = await bind(setId, "dv-inline", readerId);

			expect(body.error.code).toBe(2);
		});

		it("answers NOT_FOUND for a target that does not exist", async () => {
			const body = await bind("set.ghost");

			expect(body.error).toEqual({ code: 3, description: expect.any(String) });
		});
	},
);
