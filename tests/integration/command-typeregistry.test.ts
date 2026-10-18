import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// P2 object registry: the shell subscribes to a space's object types through
// ObjectSearchSubscribe with the space-qualified subId `type-<spaceId>`, then builds
// its type picker and typeKeyMap (uniqueKey -> id) from the returned records
// (front_web subscription.ts:646-670, record.ts:453-470). The shim must answer that
// subscription with the space's real ObjectType rows shaped as Type-layout records,
// not the empty list every non-"space" subId currently gets.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectSearchSubscribe type registry",
	() => {
		const userId = "command-types.owner";
		const outsiderId = "command-types.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: userId,
						name: "Types owner",
						email: "command-types@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Types outsider",
						email: "command-types-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: userId } });
			await prisma.user.deleteMany({
				where: { id: { in: [userId, outsiderId] } },
			});
		});

		const provisionSpace = async () => {
			signInAs(userId);
			const { account } = await (
				await post("/api/command/AccountSelect", {})
			).json();
			return account.info.accountSpaceId as string;
		};

		it("lists the space's object types for the type subscription", async () => {
			const spaceId = await provisionSpace();

			await prisma.objectType.createMany({
				data: [
					{ spaceId, uniqueKey: "ot-note", name: "Note" },
					{ spaceId, uniqueKey: "ot-report", name: "Report" },
				],
			});

			const body = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `type-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			// The two custom rows plus the three defaults every space boots with.
			expect(body.counters.total).toBe(5);
			expect(body.records).toHaveLength(5);

			const byKey = Object.fromEntries(
				body.records.map((record: any) => [record.uniqueKey, record]),
			);
			const note = byKey["ot-note"];
			expect(note).toBeDefined();
			expect(note.name).toBe("Note");
			expect(note.spaceId).toBe(spaceId);
			expect(typeof note.id).toBe("string");
			// ObjectLayout.Type === 4 in the client enum.
			expect(note.resolvedLayout).toBe(4);
			expect(note.isArchived).toBe(false);
			expect(note.isDeleted).toBe(false);
		});

		it("denies a non-member subscribing to another space's type registry", async () => {
			const spaceId = await provisionSpace();
			await prisma.objectType.create({
				data: { spaceId, uniqueKey: "ot-secret", name: "Secret" },
			});

			signInAs(outsiderId);
			const body = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `type-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
				})
			).json();

			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
			expect(body.records).toBeUndefined();
		});
	},
);
