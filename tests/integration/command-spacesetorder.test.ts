import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The vault rail lets a caller pin and drag-reorder their spaces (sidebar/page/vault.tsx:198
// for the drag, lib/util/menu.ts:881 for pin). Both send the FULL ordered list of pinned
// space views: C.SpaceSetOrder(activeSpaceViewId, orderedSpaceViewIds[]). The client reads the
// answer as positional order keys (response.ts:739 -> { list: response.spaceViewOrder }) and
// writes list[i] onto record i as its orderId; getVaultItems (menu.ts:1140) then treats
// isPinned = !!orderId and sorts pinned-first by that string. The order is personal, so it is
// stored on the caller's SpaceMember row (not the space's shared spaceView object) and
// projected back as the space subscription record's `spaceOrder`, which the client maps to
// orderId (store/detail.ts:22). A fresh subscription must therefore reflect the arrangement,
// so the reorder survives a reload rather than living only in the client's optimistic store.
describe.skipIf(!databaseAvailable)("POST /api/command/SpaceSetOrder", () => {
	const ownerId = "space-order.owner";
	const memberId = "space-order.member";
	const outsiderId = "space-order.outsider";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: ownerId,
					name: "Space order owner",
					email: "space-order-owner@vanlife.test",
				},
				{
					id: memberId,
					name: "Space order member",
					email: "space-order-member@vanlife.test",
				},
				{
					id: outsiderId,
					name: "Space order outsider",
					email: "space-order-outsider@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: ownerId } });
		await prisma.user.deleteMany({
			where: { id: { in: [ownerId, memberId, outsiderId] } },
		});
	});

	const createSpace = async (name: string) => {
		signInAs(ownerId);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name },
				useCase: 2,
			})
		).json();
		return spaceId as string;
	};

	const addMember = async (spaceId: string, userId: string) => {
		await prisma.spaceMember.create({
			data: { spaceId, userId, permission: "writer", status: "active" },
		});
	};

	const spaceRecords = async (userId = ownerId) => {
		signInAs(userId);
		const sub = await (
			await post("/api/command/ObjectSearchSubscribe", {
				subId: "space",
				filters: [],
				sorts: [],
				keys: [],
			})
		).json();
		return sub.records as any[];
	};

	const viewIdOf = (records: any[], spaceId: string) =>
		records.find((it) => it.targetSpaceId === spaceId)?.id as string;

	const orderOf = (records: any[], spaceId: string) =>
		records.find((it) => it.targetSpaceId === spaceId)?.spaceOrder;

	const setOrder = async (
		spaceViewId: string,
		spaceViewOrder: string[],
		userId = ownerId,
	) => {
		signInAs(userId);
		return (
			await post("/api/command/SpaceSetOrder", {
				spaceViewId,
				spaceViewOrder,
			})
		).json();
	};

	const memberOrder = async (spaceId: string, userId: string) =>
		(
			await prisma.spaceMember.findFirst({
				where: { spaceId, userId },
			})
		)?.orderId;

	it("persists the vault space order and reads it back on the space subscription", async () => {
		const spaceA = await createSpace("Order A");
		const spaceB = await createSpace("Order B");

		const before = await spaceRecords();
		const viewA = viewIdOf(before, spaceA);
		const viewB = viewIdOf(before, spaceB);
		expect(viewA).toBeTruthy();
		expect(viewB).toBeTruthy();
		// Neither space is pinned yet: an unordered membership projects an empty key.
		expect(orderOf(before, spaceA)).toBe("");
		expect(orderOf(before, spaceB)).toBe("");

		// Pin B above A. The vault always sends the full ordered list of pinned views.
		const body = await setOrder(viewA, [viewB, viewA]);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.spaceViewOrder).toEqual(["000000", "000001"]);

		// A fresh subscription reflects the new arrangement, so a reload keeps it.
		const after = await spaceRecords();
		expect(orderOf(after, spaceB)).toBe("000000");
		expect(orderOf(after, spaceA)).toBe("000001");

		// And it is really on the caller's membership rows, oldest-space-first is gone.
		expect(await memberOrder(spaceB, ownerId)).toBe("000000");
		expect(await memberOrder(spaceA, ownerId)).toBe("000001");
	});

	it("keeps each member's order of a shared space separate", async () => {
		const spaceA = await createSpace("Shared A");
		const spaceB = await createSpace("Shared B");
		await addMember(spaceA, memberId);
		await addMember(spaceB, memberId);

		const ownerView = await spaceRecords(ownerId);
		const viewA = viewIdOf(ownerView, spaceA);
		const viewB = viewIdOf(ownerView, spaceB);

		// Owner pins B above A; the member pins A above B.
		await setOrder(viewA, [viewB, viewA], ownerId);
		await setOrder(viewA, [viewA, viewB], memberId);

		// Each membership row keeps its own key, and each caller's own subscription reads
		// back their arrangement — the shared spaceView object is not the store.
		expect(await memberOrder(spaceA, ownerId)).toBe("000001");
		expect(await memberOrder(spaceB, ownerId)).toBe("000000");
		expect(await memberOrder(spaceA, memberId)).toBe("000000");
		expect(await memberOrder(spaceB, memberId)).toBe("000001");

		const ownerRecords = await spaceRecords(ownerId);
		expect(orderOf(ownerRecords, spaceB)).toBe("000000");
		expect(orderOf(ownerRecords, spaceA)).toBe("000001");

		const memberRecords = await spaceRecords(memberId);
		expect(orderOf(memberRecords, spaceA)).toBe("000000");
		expect(orderOf(memberRecords, spaceB)).toBe("000001");
	});

	it("ignores a space view the caller does not belong to", async () => {
		const spaceA = await createSpace("Owned A");
		const viewA = viewIdOf(await spaceRecords(ownerId), spaceA);
		await setOrder(viewA, [viewA], ownerId);

		// A non-member sends the owner's space view id: the write is scoped to the caller's
		// own memberships, so it matches nothing and creates no row.
		signInAs(outsiderId);
		const body = await setOrder(viewA, [viewA], outsiderId);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.spaceViewOrder).toEqual(["000000"]);

		const outsiderRow = await prisma.spaceMember.findFirst({
			where: { spaceId: spaceA, userId: outsiderId },
		});
		expect(outsiderRow).toBeNull();
		// The owner's order is untouched by the outsider's call.
		expect(await memberOrder(spaceA, ownerId)).toBe("000000");
	});

	it("re-orders on a later drag, last write wins", async () => {
		const spaceA = await createSpace("Rearrange A");
		const spaceB = await createSpace("Rearrange B");
		const spaceC = await createSpace("Rearrange C");

		const records = await spaceRecords(ownerId);
		const viewA = viewIdOf(records, spaceA);
		const viewB = viewIdOf(records, spaceB);
		const viewC = viewIdOf(records, spaceC);

		await setOrder(viewA, [viewC, viewB, viewA], ownerId);
		expect(await memberOrder(spaceC, ownerId)).toBe("000000");

		// Drag again into a different arrangement; the second call overwrites the first.
		const body = await setOrder(viewA, [viewA, viewB, viewC], ownerId);
		expect(body.spaceViewOrder).toEqual(["000000", "000001", "000002"]);

		const after = await spaceRecords(ownerId);
		expect(orderOf(after, spaceA)).toBe("000000");
		expect(orderOf(after, spaceB)).toBe("000001");
		expect(orderOf(after, spaceC)).toBe("000002");
	});
});
