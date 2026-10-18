import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// P2 object registry: on space open the shell subscribes to `relation-<spaceId>` with
// keys J.Relation.relation and builds S.Record.relationKeyMap (spaceId -> relationKey
// -> id) from the records (subscription.ts:731-746). The shim must answer with the
// space's real Relation rows shaped as Relation-layout records carrying relationKey
// and the numeric relationFormat the dataview/property editors read.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectSearchSubscribe relation registry",
	() => {
		const userId = "command-relations.owner";

		beforeAll(async () => {
			await prisma.user.create({
				data: {
					id: userId,
					name: "Relations owner",
					email: "command-relations@vanlife.test",
				},
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: userId } });
			await prisma.user.deleteMany({ where: { id: userId } });
		});

		const provisionSpace = async () => {
			signInAs(userId);
			const { account } = await (
				await post("/api/command/AccountSelect", {})
			).json();
			return account.info.accountSpaceId as string;
		};

		it("lists the space's relations for the relation subscription", async () => {
			const spaceId = await provisionSpace();

			await prisma.relation.createMany({
				data: [
					{ spaceId, uniqueKey: "name", name: "Name", format: "shortText" },
					{ spaceId, uniqueKey: "done", name: "Done", format: "checkbox" },
				],
			});

			const body = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `relation-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.counters.total).toBe(2);
			expect(body.records).toHaveLength(2);

			const byKey = Object.fromEntries(
				body.records.map((record: any) => [record.relationKey, record]),
			);
			const name = byKey["name"];
			expect(name).toBeDefined();
			expect(name.name).toBe("Name");
			expect(name.spaceId).toBe(spaceId);
			expect(typeof name.id).toBe("string");
			// ObjectLayout.Relation === 5 in the client enum.
			expect(name.resolvedLayout).toBe(5);
			// RelationType.ShortText === 1, Checkbox === 6.
			expect(name.relationFormat).toBe(1);
			expect(byKey["done"].relationFormat).toBe(6);
			expect(name.isReadonly).toBe(false);
			expect(name.isArchived).toBe(false);
			expect(name.isDeleted).toBe(false);
		});

		// With no options seeded the registry answers access-checked but empty,
		// pinning that the option source routes through the access guard and never
		// fabricates rows for a space that has none.
		it("answers the option subscription with an empty, access-checked list", async () => {
			const spaceId = await provisionSpace();

			const body = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `option-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.counters.total).toBe(0);
			expect(body.records).toEqual([]);
		});

		// A select relation's options are their own rows (RelationOption), projected
		// into the `option-<spaceId>` subscription as Option-layout (13) records the
		// shell reads through S.Record.getOption: name, relationKey and
		// relationOptionColor drive the cell/menu rendering.
		it("lists a select relation's options for the option subscription", async () => {
			const spaceId = await provisionSpace();

			await prisma.relation.create({
				data: {
					spaceId,
					uniqueKey: "status",
					name: "Status",
					format: "select",
				},
			});
			await prisma.relationOption.createMany({
				data: [
					{ spaceId, relationKey: "status", name: "Available", color: "green" },
					{ spaceId, relationKey: "status", name: "Sold", color: "grey" },
				],
			});

			const body = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `option-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.counters.total).toBe(2);
			expect(body.records).toHaveLength(2);

			const byName = Object.fromEntries(
				body.records.map((record: any) => [record.name, record]),
			);
			const available = byName["Available"];
			expect(available).toBeDefined();
			expect(available.spaceId).toBe(spaceId);
			expect(available.relationKey).toBe("status");
			expect(available.relationOptionColor).toBe("green");
			expect(typeof available.id).toBe("string");
			// ObjectLayout.Option === 13 in the client enum.
			expect(available.resolvedLayout).toBe(13);
			expect(available.layout).toBe(13);
			expect(available.isArchived).toBe(false);
			expect(available.isDeleted).toBe(false);
			expect(byName["Sold"].relationOptionColor).toBe("grey");
		});
	},
);
