import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// A dataview resolves each column's format and options through the relation objects in the space's
// `relation-<spaceId>` store (front_web lib/dataview.ts:15-60). A space installed no relations, so
// the store came back empty and a set's grid rendered its rows with no cells at all — reproduced
// live with 8 subscribed records that all had names. The relations the shell's own views reference
// must therefore be there from the boot, as the default types now are.
describe.skipIf(!databaseAvailable)(
	"a new space installs its default relations",
	() => {
		const userId = "spacerelations.owner";

		let spaceId = "";

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
					name: "Relations owner",
					email: "spacerelations-owner@vanlife.test",
				},
			});

			signInAs(userId);
			spaceId = (
				await (
					await post("/api/command/WorkspaceCreate", {
						details: { name: "Typed and related" },
						useCase: 2,
					})
				).json()
			).spaceId as string;
		});

		it("lists the relations its views reference", async () => {
			signInAs(userId);
			const body = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `relation-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
					offset: 0,
					limit: 100,
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });

			const keys = (body.records || []).map((it: any) => it.relationKey);
			expect(keys).toContain("name");
			expect(keys).toContain("done");
			expect(keys).toContain("description");
			expect(keys).toContain("createdDate");
		});

		it("resolves every relation link the set screen asks for", async () => {
			signInAs(userId);
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
			const pageTypeId = types.records.find(
				(it: any) => it.uniqueKey === "ot-page",
			).id;

			const created = await (
				await post("/api/command/ObjectCreateSet", {
					spaceId,
					source: [pageTypeId],
					details: { name: "Resolvable columns" },
				})
			).json();

			const opened = await (
				await post("/api/command/ObjectOpen", {
					spaceId,
					objectId: created.objectId,
				})
			).json();
			const dataview = opened.objectView.blocks.find(
				(it: any) => it.id === "dataview",
			);
			expect(dataview).toBeDefined();

			const relations = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `relation-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
					offset: 0,
					limit: 100,
				})
			).json();
			const stored = new Set(
				(relations.records || []).map((it: any) => it.relationKey),
			);

			const links: string[] = dataview.dataview.relationLinks.map(
				(it: any) => it.key,
			);
			expect(links.length).toBeGreaterThan(0);
			for (const key of links) {
				expect(stored.has(key)).toBe(true);
			}
			for (const relation of dataview.dataview.views[0].relations) {
				expect(stored.has(relation.key)).toBe(true);
			}
		});
	},
);
