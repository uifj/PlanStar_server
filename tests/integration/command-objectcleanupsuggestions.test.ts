import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ObjectCleanupSuggestions backs the Bin's "Suggested for cleanup" tab
// (component/page/main/archiveSuggested.tsx:81, lib/util/data.ts:77). The client sends
// { spaceId, keys } and reads { items: [{ details, isRoot, reason }] } (response.ts:292),
// rendering the orphans as a forest joined on details.createdInContext -> parent id.
//
// An orphan ROOT is a live object (neither deleted nor archived itself) whose createdInContext
// parent is no longer a live home for it: the parent is archived (CleanupReason.ContextArchived=1)
// or deleted/gone (ContextDeleted=2). Objects created in the context of an orphan are pulled in as
// DESCENDANTS with isRoot:false and reason None=0 (common.ts:83 "descendants inherit their root's
// reason and carry None"). Items are sorted by id. ContextUnlinked=3 is not produced yet: detecting
// a live-but-unlinked context needs the body link graph, which is deferred with the P3 body model.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectCleanupSuggestions",
	() => {
		const ownerId = "cleanup.owner";
		const outsiderId = "cleanup.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Cleanup owner",
						email: "cleanup-owner@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Cleanup outsider",
						email: "cleanup-outsider@vanlife.test",
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
					details: { name: "Cleanup space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		// Seed an object straight through Prisma so the orphan wiring (createdInContext) and
		// the lifecycle flags are exactly the state under test, independent of ObjectCreate's
		// detail filtering. An explicit id keeps the createdInContext edges and the sort test
		// deterministic.
		const seedObject = async (
			spaceId: string,
			id: string,
			options: {
				name?: string;
				createdInContext?: string;
				isArchived?: boolean;
				isDeleted?: boolean;
			} = {},
		) => {
			await prisma.obj.create({
				data: {
					id,
					spaceId,
					name: options.name ?? "",
					isArchived: options.isArchived ?? false,
					isDeleted: options.isDeleted ?? false,
					details: options.createdInContext
						? { createdInContext: options.createdInContext }
						: {},
				},
			});
			return id;
		};

		const suggestions = async (spaceId: string) => {
			signInAs(ownerId);
			return (
				await post("/api/command/ObjectCleanupSuggestions", {
					spaceId,
					keys: ["name", "type"],
				})
			).json();
		};

		const itemById = (body: any, id: string) =>
			(body.items || []).find((it: any) => it.details.id === id);

		it("returns a live object whose context was archived, as a root", async () => {
			const spaceId = await createSpace();
			await seedObject(spaceId, "ctx-archived", { name: "Parent" });
			await seedObject(spaceId, "orphan-archived", {
				name: "Child",
				createdInContext: "ctx-archived",
			});
			await prisma.obj.update({
				where: { id: "ctx-archived" },
				data: { isArchived: true },
			});

			const body = await suggestions(spaceId);
			expect(body.error).toEqual({ code: 0, description: "" });

			const item = itemById(body, "orphan-archived");
			expect(item).toBeDefined();
			expect(item.isRoot).toBe(true);
			expect(item.reason).toBe(1);
		});

		it("returns a live object whose context was deleted, as a root", async () => {
			const spaceId = await createSpace();
			await seedObject(spaceId, "ctx-deleted", { name: "Parent" });
			await seedObject(spaceId, "orphan-deleted", {
				name: "Child",
				createdInContext: "ctx-deleted",
			});
			await prisma.obj.update({
				where: { id: "ctx-deleted" },
				data: { isDeleted: true },
			});

			const body = await suggestions(spaceId);
			const item = itemById(body, "orphan-deleted");
			expect(item).toBeDefined();
			expect(item.isRoot).toBe(true);
			expect(item.reason).toBe(2);
		});

		it("pulls an object created inside an orphan in as a descendant root-less item", async () => {
			const spaceId = await createSpace();
			await seedObject(spaceId, "ctx-gone", { name: "Parent" });
			await seedObject(spaceId, "root-orphan", {
				name: "Child",
				createdInContext: "ctx-gone",
			});
			await seedObject(spaceId, "grandchild", {
				name: "Grandchild",
				createdInContext: "root-orphan",
			});
			await prisma.obj.update({
				where: { id: "ctx-gone" },
				data: { isArchived: true },
			});

			const body = await suggestions(spaceId);

			const root = itemById(body, "root-orphan");
			expect(root.isRoot).toBe(true);
			expect(root.reason).toBe(1);

			// The grandchild's own context (root-orphan) is live, so it is not a root; it is
			// included only because it descends from one, and carries reason None.
			const descendant = itemById(body, "grandchild");
			expect(descendant).toBeDefined();
			expect(descendant.isRoot).toBe(false);
			expect(descendant.reason).toBe(0);
		});

		it("omits an object whose context is still live", async () => {
			const spaceId = await createSpace();
			await seedObject(spaceId, "ctx-live", { name: "Parent" });
			await seedObject(spaceId, "not-an-orphan", {
				name: "Child",
				createdInContext: "ctx-live",
			});

			const body = await suggestions(spaceId);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(itemById(body, "not-an-orphan")).toBeUndefined();
		});

		it("omits an object with no createdInContext", async () => {
			const spaceId = await createSpace();
			await seedObject(spaceId, "free-standing", { name: "Top level" });

			const body = await suggestions(spaceId);
			expect(itemById(body, "free-standing")).toBeUndefined();
		});

		it("omits an orphan that is itself archived", async () => {
			const spaceId = await createSpace();
			await seedObject(spaceId, "ctx-archived-2", { name: "Parent" });
			await seedObject(spaceId, "archived-orphan", {
				name: "Child",
				createdInContext: "ctx-archived-2",
				isArchived: true,
			});
			await prisma.obj.update({
				where: { id: "ctx-archived-2" },
				data: { isArchived: true },
			});

			const body = await suggestions(spaceId);
			// Already in the Bin, so it is not a cleanup candidate.
			expect(itemById(body, "archived-orphan")).toBeUndefined();
		});

		it("sorts items by id ascending", async () => {
			const spaceId = await createSpace();
			await seedObject(spaceId, "sort-ctx", { name: "Parent" });
			await seedObject(spaceId, "z-orphan", {
				name: "Z",
				createdInContext: "sort-ctx",
			});
			await seedObject(spaceId, "a-orphan", {
				name: "A",
				createdInContext: "sort-ctx",
			});
			await prisma.obj.update({
				where: { id: "sort-ctx" },
				data: { isArchived: true },
			});

			const body = await suggestions(spaceId);
			const ids = (body.items || []).map((it: any) => it.details.id);
			expect(ids).toEqual(["a-orphan", "z-orphan"]);
		});

		it("always projects id, createdInContext and resolvedLayout onto details", async () => {
			const spaceId = await createSpace();
			await seedObject(spaceId, "proj-ctx", { name: "Parent" });
			await seedObject(spaceId, "proj-orphan", {
				name: "Child",
				createdInContext: "proj-ctx",
			});
			await prisma.obj.update({
				where: { id: "proj-ctx" },
				data: { isArchived: true },
			});

			const body = await suggestions(spaceId);
			const { details } = itemById(body, "proj-orphan");
			expect(details.id).toBe("proj-orphan");
			expect(details.createdInContext).toBe("proj-ctx");
			expect(details.resolvedLayout).toBe(0);
		});

		it("denies a caller who cannot read the space", async () => {
			const spaceId = await createSpace();

			signInAs(outsiderId);
			const res = await post("/api/command/ObjectCleanupSuggestions", {
				spaceId,
				keys: ["name"],
			});
			expect((await res.json()).error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
