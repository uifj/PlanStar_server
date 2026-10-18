import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// After the caller drags options into a new order the client sends
// RelationOptionSetOrder({ spaceId, relationKey, relationOptionOrder }) (command.ts:1237)
// and reads the persisted order back off the response (response.ts:808). The shim must
// store the order so the option subscription (optionRecords) returns the options in that
// order across a reload — a bare OK that drops the order would be a fake success.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/RelationOptionSetOrder",
	() => {
		const owner = "relation-order.owner";
		const outsider = "relation-order.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Order owner",
						email: "order-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Order outsider",
						email: "order-outsider@vanlife.test",
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
			await prisma.relation.upsert({
				where: { spaceId_uniqueKey: { spaceId, uniqueKey: "priority" } },
				create: {
					spaceId,
					uniqueKey: "priority",
					name: "Priority",
					format: "select",
				},
				update: {},
			});
			return spaceId;
		};

		const createOption = async (spaceId: string, name: string) => {
			const created = await (
				await post("/api/command/ObjectCreateRelationOption", {
					spaceId,
					details: {
						relationKey: "priority",
						name,
						relationOptionColor: "grey",
					},
				})
			).json();
			return created.objectId as string;
		};

		it("persists a dragged option order and echoes it back", async () => {
			const spaceId = await provisionSpace();
			const first = await createOption(spaceId, "First");
			const second = await createOption(spaceId, "Second");
			const third = await createOption(spaceId, "Third");

			// Drag into a new order: third, first, second.
			const ordered = [third, first, second];
			const body = await (
				await post("/api/command/RelationOptionSetOrder", {
					spaceId,
					relationKey: "priority",
					relationOptionOrder: ordered,
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.relationOptionOrder).toEqual(ordered);

			// The option subscription reads the persisted order back, so a reload shows
			// the columns in the dragged sequence.
			const subscribed = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `option-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
				})
			).json();

			expect(subscribed.records.map((it: any) => it.id)).toEqual(ordered);
		});

		it("forbids a non-member from reordering options", async () => {
			const spaceId = await provisionSpace();
			const option = await createOption(spaceId, "Guarded");

			signInAs(outsider);
			const body = await (
				await post("/api/command/RelationOptionSetOrder", {
					spaceId,
					relationKey: "priority",
					relationOptionOrder: [option],
				})
			).json();

			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
