import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The Bin screen (page/main/archive.tsx -> archiveListTree.tsx:36) subscribes under
// J.Constant.subId.archive with its own `isArchived Equal true` filter and a key list, and renders a
// row per record. "archive" was parked among the subIds that must stay empty, so the screen answered
// "Your Bin is empty" while the space held binned objects, and Restore could never be attempted from
// the UI. It is a plain filter-driven object list, so the fix is to stop suppressing it.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectSearchSubscribe subId=archive (the Bin)",
	() => {
		const owner = "binsub.owner";
		const outsider = "binsub.outsider";

		beforeAll(async () => {
			await prisma.user.deleteMany({
				where: { id: { in: [owner, outsider] } },
			});
			await prisma.user.createMany({
				data: [
					{ id: owner, name: "Bin owner", email: "binsub-owner@vanlife.test" },
					{
						id: outsider,
						name: "Bin outsider",
						email: "binsub-outsider@vanlife.test",
					},
				],
			});
		});

		const provision = async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Bin subscribe space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		const createPage = async (spaceId: string, name: string) => {
			signInAs(owner);
			const { objectId } = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					objectTypeUniqueKey: "ot-page",
					details: { name },
				})
			).json();
			return objectId as string;
		};

		// archiveListTree.tsx:39-40 — the keys and filter the screen actually sends.
		const bin = async (spaceId: string, as = owner) => {
			signInAs(as);
			return (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: "archive",
					filters: [
						{ RelationKey: "isArchived", format: 8, condition: 1, value: true },
					],
					sorts: [{ RelationKey: "lastModifiedDate", type: 1, format: 4 }],
					keys: [
						"name",
						"description",
						"iconEmoji",
						"iconImage",
						"iconOption",
						"layout",
						"type",
						"lastModifiedDate",
						"creator",
						"createdInContext",
					],
					source: [],
					offset: 0,
					limit: 100,
				})
			).json();
		};

		it("lists the space's binned objects with the fields the row renders", async () => {
			const spaceId = await provision();
			const binned = await createPage(spaceId, "Binned page");
			const kept = await createPage(spaceId, "Kept page");

			signInAs(owner);
			const archived = await (
				await post("/api/command/ObjectListSetIsArchived", {
					objectIds: [binned],
					isArchived: true,
				})
			).json();
			expect(archived.error).toEqual({ code: 0, description: "" });

			const body = await bin(spaceId);
			expect(body.error).toEqual({ code: 0, description: "" });

			const byId = new Map((body.records || []).map((it: any) => [it.id, it]));
			expect(byId.has(binned)).toBe(true);
			expect(byId.has(kept)).toBe(false);
			expect(byId.get(binned).name).toBe("Binned page");
			expect(body.counters.total).toBe(1);
		});

		it("empties the list again when the object is restored", async () => {
			const spaceId = await provision();
			const binned = await createPage(spaceId, "Round trip page");

			signInAs(owner);
			await post("/api/command/ObjectListSetIsArchived", {
				objectIds: [binned],
				isArchived: true,
			});
			expect((await bin(spaceId)).records.map((it: any) => it.id)).toContain(
				binned,
			);

			signInAs(owner);
			await post("/api/command/ObjectListSetIsArchived", {
				objectIds: [binned],
				isArchived: false,
			});

			const after = await bin(spaceId);
			expect((after.records || []).map((it: any) => it.id)).not.toContain(
				binned,
			);
		});

		it("refuses a caller who cannot read the space", async () => {
			const spaceId = await provision();
			const binned = await createPage(spaceId, "Private binned");

			signInAs(owner);
			await post("/api/command/ObjectListSetIsArchived", {
				objectIds: [binned],
				isArchived: true,
			});

			const body = await bin(spaceId, outsider);
			expect(body.error.code).toBe(2);
		});
	},
);
