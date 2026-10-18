import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ObjectCleanupSuggestionIgnore (command.ts:1663, archiveSuggested.tsx:240) lets the user
// permanently dismiss rows from the Bin's "Suggested for cleanup" forest. The client sends
// { objectIds, ignored } — note there is no spaceId — and reads only error.code, then reloads the
// list. Ignoring an object drops it AND its createdInContext descendants from
// ObjectCleanupSuggestions; ignored=false restores them. Because the request carries no space, the
// space is resolved from the object ids and the write is gated at the writer floor (it mutates
// durable per-object state), so a non-member cannot flip another space's ignore flags.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectCleanupSuggestionIgnore",
	() => {
		const ownerId = "cleanupignore.owner";
		const outsiderId = "cleanupignore.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Cleanup-ignore owner",
						email: "cleanupignore-owner@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Cleanup-ignore outsider",
						email: "cleanupignore-outsider@vanlife.test",
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
					details: { name: "Cleanup-ignore space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

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

		// A shared orphan forest: an archived parent makes `root` an orphan root and `grandchild`
		// its descendant, so one seed exercises both the root and the subtree-drop behaviours.
		const seedForest = async (spaceId: string, tag: string) => {
			await seedObject(spaceId, `${tag}-ctx`, { name: "Parent" });
			await seedObject(spaceId, `${tag}-root`, {
				name: "Child",
				createdInContext: `${tag}-ctx`,
			});
			await seedObject(spaceId, `${tag}-grandchild`, {
				name: "Grandchild",
				createdInContext: `${tag}-root`,
			});
			await prisma.obj.update({
				where: { id: `${tag}-ctx` },
				data: { isArchived: true },
			});
		};

		const suggestions = async (spaceId: string) => {
			signInAs(ownerId);
			return (
				await post("/api/command/ObjectCleanupSuggestions", {
					spaceId,
					keys: ["name"],
				})
			).json();
		};

		const ignore = async (objectIds: string[], ignored: boolean) => {
			signInAs(ownerId);
			return (
				await post("/api/command/ObjectCleanupSuggestionIgnore", {
					objectIds,
					ignored,
				})
			).json();
		};

		const itemById = (body: any, id: string) =>
			(body.items || []).find((it: any) => it.details.id === id);

		it("drops an ignored orphan root from the suggestions", async () => {
			const spaceId = await createSpace();
			await seedForest(spaceId, "drop-root");

			const res = await ignore(["drop-root-root"], true);
			expect(res.error).toEqual({ code: 0, description: "" });

			const body = await suggestions(spaceId);
			expect(itemById(body, "drop-root-root")).toBeUndefined();
		});

		it("drops the descendants of an ignored root too", async () => {
			const spaceId = await createSpace();
			await seedForest(spaceId, "drop-desc");

			await ignore(["drop-desc-root"], true);

			const body = await suggestions(spaceId);
			expect(itemById(body, "drop-desc-root")).toBeUndefined();
			expect(itemById(body, "drop-desc-grandchild")).toBeUndefined();
		});

		it("restores an object and its subtree when ignored is false", async () => {
			const spaceId = await createSpace();
			await seedForest(spaceId, "restore");

			await ignore(["restore-root"], true);
			expect(
				itemById(await suggestions(spaceId), "restore-root"),
			).toBeUndefined();

			const res = await ignore(["restore-root"], false);
			expect(res.error).toEqual({ code: 0, description: "" });

			const body = await suggestions(spaceId);
			expect(itemById(body, "restore-root")).toBeDefined();
			expect(itemById(body, "restore-grandchild")).toBeDefined();
		});

		it("denies a caller who cannot write to the space", async () => {
			const spaceId = await createSpace();
			await seedForest(spaceId, "gate");

			signInAs(outsiderId);
			const res = await post("/api/command/ObjectCleanupSuggestionIgnore", {
				objectIds: ["gate-root"],
				ignored: true,
			});
			expect((await res.json()).error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});

		it("answers NOT_FOUND when no object id resolves to a space", async () => {
			const body = await ignore(["does-not-exist"], true);
			expect(body.error).toEqual({
				code: 3,
				description: "Object not found.",
			});
		});
	},
);
