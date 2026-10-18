import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The vault's "unpin" action (lib/util/menu.ts:889) fires C.SpaceUnsetOrder(space.id) with a
// single { spaceViewId } and no callback; unlike pin (which sends the whole ordered list via
// SpaceSetOrder) it names just the space to drop. It is write-only (no response mapper). Since
// getVaultItems reads isPinned = !!orderId off the space subscription record's spaceOrder,
// unpinning one space must clear only that caller's SpaceMember.orderId back to "" and leave
// every other pinned space's key intact, so the rest of the rail keeps its order. Like
// SpaceSetOrder the arrangement is personal, so a caller can only unset their own membership:
// a space view they do not belong to matches no row. A fresh subscription must read the space
// back as unpinned, so the unpin survives a reload rather than living only in the client.
describe.skipIf(!databaseAvailable)("POST /api/command/SpaceUnsetOrder", () => {
	const ownerId = "space-unset.owner";
	const memberId = "space-unset.member";
	const outsiderId = "space-unset.outsider";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: ownerId,
					name: "Space unset owner",
					email: "space-unset-owner@vanlife.test",
				},
				{
					id: memberId,
					name: "Space unset member",
					email: "space-unset-member@vanlife.test",
				},
				{
					id: outsiderId,
					name: "Space unset outsider",
					email: "space-unset-outsider@vanlife.test",
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

	const unsetOrder = async (spaceViewId: string, userId = ownerId) => {
		signInAs(userId);
		return (await post("/api/command/SpaceUnsetOrder", { spaceViewId })).json();
	};

	const memberOrder = async (spaceId: string, userId: string) =>
		(
			await prisma.spaceMember.findFirst({
				where: { spaceId, userId },
			})
		)?.orderId;

	it("unpins one space, clearing only its order and reading back unpinned", async () => {
		const spaceA = await createSpace("Unset A");
		const spaceB = await createSpace("Unset B");

		const records = await spaceRecords(ownerId);
		const viewA = viewIdOf(records, spaceA);
		const viewB = viewIdOf(records, spaceB);

		// Pin both: A above B.
		await setOrder(viewA, [viewA, viewB], ownerId);
		expect(await memberOrder(spaceA, ownerId)).toBe("000000");
		expect(await memberOrder(spaceB, ownerId)).toBe("000001");

		// Unpin A only. B keeps its key, so the rest of the rail is undisturbed.
		const body = await unsetOrder(viewA, ownerId);
		expect(body.error).toEqual({ code: 0, description: "" });

		const after = await spaceRecords(ownerId);
		expect(orderOf(after, spaceA)).toBe("");
		expect(orderOf(after, spaceB)).toBe("000001");

		expect(await memberOrder(spaceA, ownerId)).toBe("");
		expect(await memberOrder(spaceB, ownerId)).toBe("000001");
	});

	it("unpins only the caller's order of a shared space", async () => {
		const spaceA = await createSpace("Shared unset A");
		const spaceB = await createSpace("Shared unset B");
		await addMember(spaceA, memberId);
		await addMember(spaceB, memberId);

		const ownerView = await spaceRecords(ownerId);
		const viewA = viewIdOf(ownerView, spaceA);
		const viewB = viewIdOf(ownerView, spaceB);

		// Both the owner and the member pin A above B on their own rails.
		await setOrder(viewA, [viewA, viewB], ownerId);
		await setOrder(viewA, [viewA, viewB], memberId);

		// The owner unpins A; the member's pin of the same shared space is untouched.
		await unsetOrder(viewA, ownerId);

		expect(await memberOrder(spaceA, ownerId)).toBe("");
		expect(await memberOrder(spaceB, ownerId)).toBe("000001");
		expect(await memberOrder(spaceA, memberId)).toBe("000000");
		expect(await memberOrder(spaceB, memberId)).toBe("000001");

		const ownerRecords = await spaceRecords(ownerId);
		expect(orderOf(ownerRecords, spaceA)).toBe("");

		const memberRecords = await spaceRecords(memberId);
		expect(orderOf(memberRecords, spaceA)).toBe("000000");
	});

	it("ignores a space view the caller does not belong to", async () => {
		const spaceA = await createSpace("Owned unset A");
		const viewA = viewIdOf(await spaceRecords(ownerId), spaceA);
		await setOrder(viewA, [viewA], ownerId);

		// A non-member sends the owner's space view id: the write is scoped to the caller's
		// own memberships, so it matches nothing, creates no row, and leaves the owner's pin.
		const body = await unsetOrder(viewA, outsiderId);
		expect(body.error).toEqual({ code: 0, description: "" });

		const outsiderRow = await prisma.spaceMember.findFirst({
			where: { spaceId: spaceA, userId: outsiderId },
		});
		expect(outsiderRow).toBeNull();
		expect(await memberOrder(spaceA, ownerId)).toBe("000000");
	});
});
