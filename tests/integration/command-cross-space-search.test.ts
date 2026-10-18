import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// P4 cross-space search: ObjectCrossSpaceSearch(filters, sorts, keys, fullText, ...)
// carries no spaceId — the global search popup spans every space the caller is an
// active member of. It must match live objects by name or projected body snippet and
// never leak objects from spaces the caller cannot read.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectCrossSpaceSearch",
	() => {
		const ownerId = "command-xsearch.owner";
		const outsiderId = "command-xsearch.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "XSearch owner",
						email: "command-xsearch-owner@vanlife.test",
					},
					{
						id: outsiderId,
						name: "XSearch outsider",
						email: "command-xsearch-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({
				where: { createdBy: { in: [ownerId, outsiderId] } },
			});
			await prisma.user.deleteMany({
				where: { id: { in: [ownerId, outsiderId] } },
			});
		});

		const createSpace = async (as: string, name: string) => {
			signInAs(as);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name },
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

		const search = async (fullText: string, as = ownerId) => {
			signInAs(as);
			const body = await (
				await post("/api/command/ObjectCrossSpaceSearch", {
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

		it("finds objects across every space the caller belongs to", async () => {
			const spaceA = await createSpace(ownerId, "XSearch space A");
			const spaceB = await createSpace(ownerId, "XSearch space B");
			await createObject(spaceA, "Alpine quokka");
			await createObject(spaceB, "Coastal quokka");

			const body = await search("quokka");
			expect(body.error).toEqual({ code: 0, description: "" });

			const names = body.records.map((it: any) => it.name);
			expect(names).toContain("Alpine quokka");
			expect(names).toContain("Coastal quokka");
		});

		it("never returns objects from a space the caller cannot read", async () => {
			const ownerSpace = await createSpace(ownerId, "XSearch owner space");
			const outsiderSpace = await createSpace(
				outsiderId,
				"XSearch outsider space",
			);
			await createObject(ownerSpace, "Visible echidna");

			signInAs(outsiderId);
			await post("/api/command/ObjectCreate", {
				spaceId: outsiderSpace,
				details: { name: "Secret echidna" },
			});

			const body = await search("echidna");
			const names = body.records.map((it: any) => it.name);
			expect(names).toContain("Visible echidna");
			expect(names).not.toContain("Secret echidna");
		});

		it("returns nothing for an empty query", async () => {
			const spaceId = await createSpace(ownerId, "XSearch empty space");
			await createObject(spaceId, "Some page");

			const body = await search("   ");
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.records).toEqual([]);
		});
	},
);
