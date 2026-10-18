import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The relation editor's "new relation" path sends ObjectCreateRelation({ name,
// relationFormat }) with a numeric format and no key (dataview/relation/edit.tsx:594),
// then feeds message.details into the relation subscription store keyed by details.id and
// reads response.key as the relationKey (response.ts:245). The shim must map the numeric
// I.RelationType to the registry's format enum, mint a space-unique key, create a real
// Relation row, and answer with the full relation record (layout 5). A bare OK — or a
// relation that never reaches relation-<spaceId> — would be a fake success.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectCreateRelation",
	() => {
		const owner = "create-relation.owner";
		const outsider = "create-relation.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Relation owner",
						email: "relation-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Relation outsider",
						email: "relation-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({
				where: { id: { in: [owner, outsider] } },
			});
		});

		const provisionSpace = async () => {
			signInAs(owner);
			const { account } = await (
				await post("/api/command/AccountSelect", {})
			).json();
			return account.info.accountSpaceId as string;
		};

		it("creates a select relation and returns its relation record", async () => {
			const spaceId = await provisionSpace();

			const body = await (
				await post("/api/command/ObjectCreateRelation", {
					spaceId,
					// I.RelationType.Select === 3.
					details: { name: "Status", relationFormat: 3 },
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(typeof body.objectId).toBe("string");
			expect(body.objectId.length).toBeGreaterThan(0);
			// response.ts:245 maps response.key -> relationKey.
			expect(body.key).toBe(body.details.relationKey);
			expect(body.key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
			expect(body.details.id).toBe(body.objectId);
			expect(body.details.name).toBe("Status");
			// I.ObjectLayout.Relation === 5.
			expect(body.details.layout).toBe(5);
			expect(body.details.resolvedLayout).toBe(5);
			// The numeric format round-trips through the enum back to the wire number.
			expect(body.details.relationFormat).toBe(3);
		});

		it("makes the new relation readable through the relation subscription", async () => {
			const spaceId = await provisionSpace();

			const created = await (
				await post("/api/command/ObjectCreateRelation", {
					spaceId,
					// I.RelationType.Number === 2.
					details: { name: "Distance", relationFormat: 2 },
				})
			).json();

			const subscribed = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `relation-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
				})
			).json();

			const match = subscribed.records.find(
				(it: any) => it.id === created.objectId,
			);
			expect(match).toBeDefined();
			expect(match.name).toBe("Distance");
			expect(match.layout).toBe(5);
			expect(match.relationFormat).toBe(2);
		});

		it("mints a distinct key for two relations created with the same name", async () => {
			const spaceId = await provisionSpace();

			const first = await (
				await post("/api/command/ObjectCreateRelation", {
					spaceId,
					details: { name: "Link", relationFormat: 100 },
				})
			).json();
			const second = await (
				await post("/api/command/ObjectCreateRelation", {
					spaceId,
					details: { name: "Link", relationFormat: 100 },
				})
			).json();

			expect(first.error).toEqual({ code: 0, description: "" });
			expect(second.error).toEqual({ code: 0, description: "" });
			expect(second.objectId).not.toBe(first.objectId);
			expect(second.key).not.toBe(first.key);
		});

		it("forbids a non-member from creating a relation in the space", async () => {
			const spaceId = await provisionSpace();

			signInAs(outsider);
			const body = await (
				await post("/api/command/ObjectCreateRelation", {
					spaceId,
					details: { name: "Intruder", relationFormat: 1 },
				})
			).json();

			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
