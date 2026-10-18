import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// A select relation's options are created through ObjectCreateRelationOption
// (command.ts) with { relationKey, name, relationOptionColor } details. The shim
// must persist a RelationOption row scoped to the space and answer with the new
// option's objectId + details so the client can drop it straight into the global
// option subscription store (optionSelect.tsx:449-456).
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectCreateRelationOption",
	() => {
		const owner = "relation-option.owner";
		const outsider = "relation-option.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Option owner",
						email: "option-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Option outsider",
						email: "option-outsider@vanlife.test",
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
			const spaceId = account.info.accountSpaceId as string;
			// All three cases share the owner's one account space, so the select
			// relation is upserted rather than created twice.
			await prisma.relation.upsert({
				where: { spaceId_uniqueKey: { spaceId, uniqueKey: "status" } },
				create: {
					spaceId,
					uniqueKey: "status",
					name: "Status",
					format: "select",
				},
				update: {},
			});
			return spaceId;
		};

		it("creates an option that surfaces in the option subscription", async () => {
			const spaceId = await provisionSpace();

			const created = await (
				await post("/api/command/ObjectCreateRelationOption", {
					spaceId,
					details: {
						relationKey: "status",
						name: "Available",
						relationOptionColor: "green",
					},
				})
			).json();

			expect(created.error).toEqual({ code: 0, description: "" });
			expect(typeof created.objectId).toBe("string");
			expect(created.details).toMatchObject({
				id: created.objectId,
				name: "Available",
				relationKey: "status",
				relationOptionColor: "green",
			});

			const subscribed = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `option-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
				})
			).json();

			expect(subscribed.records).toHaveLength(1);
			expect(subscribed.records[0]).toMatchObject({
				id: created.objectId,
				name: "Available",
				relationKey: "status",
				relationOptionColor: "green",
				resolvedLayout: 13,
			});
		});

		it("rejects an option for a relation that does not exist", async () => {
			const spaceId = await provisionSpace();

			const created = await (
				await post("/api/command/ObjectCreateRelationOption", {
					spaceId,
					details: {
						relationKey: "nope",
						name: "Ghost",
						relationOptionColor: "grey",
					},
				})
			).json();

			expect(created.error).toEqual({
				code: 3,
				description: "Object not found.",
			});
		});

		it("forbids a non-member from creating an option", async () => {
			const spaceId = await provisionSpace();

			signInAs(outsider);
			const created = await (
				await post("/api/command/ObjectCreateRelationOption", {
					spaceId,
					details: {
						relationKey: "status",
						name: "Sneaky",
						relationOptionColor: "red",
					},
				})
			).json();

			expect(created.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
