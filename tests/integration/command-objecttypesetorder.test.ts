import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The left widget's type rail is drag-reorderable (widget/object.tsx:244): onSortEnd runs
// U.Data.sortByOrderIdRequest then C.ObjectTypeSetOrder(spaceId, typeIds). command.ts:1159 sends
// { spaceId, typeIds }; response.ts:587 maps { list: response.orderIds || [] } and
// sortByOrderIdRequest assigns details.orderId = list[i] to items[i]. On reload S.Record.getTypes()
// -> sortTypes sorts by U.Data.sortByOrderId, which string-compares record.orderId (an empty
// orderId sorts last). So a faithful server persists an orderId per ObjectType and projects it in
// the type subscription record: after ObjectTypeSetOrder([c, a, b]) the type-<spaceId> subscription
// must return orderIds that string-sort c < a < b, and a reorder must replace the previous order.
// A bare OK that leaves every orderId empty would silently drop the user's arrangement on reload (a
// fake success); a never-ordered type keeps an empty orderId; reordering is a space write, so a
// reader and a non-member are both FORBIDDEN and the stored order is unchanged.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectTypeSetOrder",
	() => {
		const owner = "type-order.owner";
		const reader = "type-order.reader";
		const outsider = "type-order.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Type order owner",
						email: "type-order-owner@vanlife.test",
					},
					{
						id: reader,
						name: "Type order reader",
						email: "type-order-reader@vanlife.test",
					},
					{
						id: outsider,
						name: "Type order outsider",
						email: "type-order-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({
				where: { id: { in: [owner, reader, outsider] } },
			});
		});

		const provisionSpace = async () => {
			signInAs(owner);
			const { account } = await (
				await post("/api/command/AccountSelect", {})
			).json();
			return account.info.accountSpaceId as string;
		};

		const createType = async (spaceId: string, name: string) => {
			signInAs(owner);
			const created = await (
				await post("/api/command/ObjectCreateObjectType", {
					spaceId,
					details: { name },
					internalFlags: [],
				})
			).json();
			return created.objectId as string;
		};

		const setOrder = async (spaceId: string, typeIds: string[]) => {
			signInAs(owner);
			return (
				await post("/api/command/ObjectTypeSetOrder", { spaceId, typeIds })
			).json();
		};

		// Read the persisted orderId for every type through the same subscription the widget
		// reloads from (type-<spaceId>), returned as an id -> orderId map.
		const readOrder = async (spaceId: string) => {
			signInAs(owner);
			const subscribed = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `type-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
				})
			).json();
			const map: Record<string, string> = {};
			for (const record of subscribed.records as any[]) {
				map[record.id] = record.orderId;
			}
			return map;
		};

		it("persists the requested order and reads it back through the type subscription", async () => {
			const spaceId = await provisionSpace();
			const a = await createType(spaceId, "Alpha");
			const b = await createType(spaceId, "Beta");
			const c = await createType(spaceId, "Gamma");

			const body = await setOrder(spaceId, [c, a, b]);
			expect(body.error).toEqual({ code: 0, description: "" });

			const order = await readOrder(spaceId);
			// The client sorts by plain string comparison, so the requested sequence must be
			// strictly increasing in the stored orderId.
			expect(order[c] < order[a]).toBe(true);
			expect(order[a] < order[b]).toBe(true);
		});

		it("replaces the previous order on a reorder", async () => {
			const spaceId = await provisionSpace();
			const a = await createType(spaceId, "Alpha");
			const b = await createType(spaceId, "Beta");
			const c = await createType(spaceId, "Gamma");

			await setOrder(spaceId, [a, b, c]);
			await setOrder(spaceId, [c, b, a]);

			const order = await readOrder(spaceId);
			expect(order[c] < order[b]).toBe(true);
			expect(order[b] < order[a]).toBe(true);
		});

		it("returns orderIds positionally matching typeIds, strictly increasing", async () => {
			const spaceId = await provisionSpace();
			const a = await createType(spaceId, "Alpha");
			const b = await createType(spaceId, "Beta");
			const c = await createType(spaceId, "Gamma");

			const body = await setOrder(spaceId, [c, a, b]);
			expect(body.orderIds).toHaveLength(3);
			expect(body.orderIds[0] < body.orderIds[1]).toBe(true);
			expect(body.orderIds[1] < body.orderIds[2]).toBe(true);

			// What the response echoes is exactly what the subscription later carries.
			const order = await readOrder(spaceId);
			expect(order[c]).toBe(body.orderIds[0]);
			expect(order[a]).toBe(body.orderIds[1]);
			expect(order[b]).toBe(body.orderIds[2]);
		});

		it("leaves a never-ordered type with an empty orderId", async () => {
			const spaceId = await provisionSpace();
			const a = await createType(spaceId, "Alpha");

			const order = await readOrder(spaceId);
			expect(order[a]).toBe("");
		});

		it("forbids a reader and leaves the order unchanged", async () => {
			const spaceId = await provisionSpace();
			const a = await createType(spaceId, "Alpha");
			const b = await createType(spaceId, "Beta");
			await setOrder(spaceId, [a, b]);
			const before = await readOrder(spaceId);

			await prisma.spaceMember.create({
				data: {
					spaceId,
					userId: reader,
					permission: "reader",
					status: "active",
				},
			});

			signInAs(reader);
			const body = await (
				await post("/api/command/ObjectTypeSetOrder", {
					spaceId,
					typeIds: [b, a],
				})
			).json();
			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});

			const after = await readOrder(spaceId);
			expect(after[a]).toBe(before[a]);
			expect(after[b]).toBe(before[b]);
			expect(after[a] < after[b]).toBe(true);
		});

		it("forbids a non-member and leaves the order unchanged", async () => {
			const spaceId = await provisionSpace();
			const a = await createType(spaceId, "Alpha");
			const b = await createType(spaceId, "Beta");
			await setOrder(spaceId, [a, b]);
			const before = await readOrder(spaceId);

			signInAs(outsider);
			const body = await (
				await post("/api/command/ObjectTypeSetOrder", {
					spaceId,
					typeIds: [b, a],
				})
			).json();
			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});

			const after = await readOrder(spaceId);
			expect(after[a]).toBe(before[a]);
			expect(after[b]).toBe(before[b]);
		});
	},
);
