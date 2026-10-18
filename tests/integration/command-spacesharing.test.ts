import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// Sharing state. The share sheet flips a space to Shared before minting an invite
// (settings/space/share.tsx onLinkToggle -> SpaceMakeShareable) and back to Private when sharing
// stops (Action.inviteRevoke / menu.ts -> SpaceStopSharing). The client derives `isShared` from the
// spaceView record's spaceAccessType (store/detail.ts:576, Shared = 2), surfaced through the global
// "space" subscription. Both commands are owner-gated; SpaceStopSharing also revokes the live invite.
describe.skipIf(!databaseAvailable)("space sharing state", () => {
	const owner = "sharing.owner";
	const admin = "sharing.admin";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: owner,
					name: "Sharing owner",
					email: "sharing-owner@vanlife.test",
				},
				{
					id: admin,
					name: "Sharing admin",
					email: "sharing-admin@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: owner } });
		await prisma.user.deleteMany({
			where: { id: { in: [owner, admin] } },
		});
	});

	const provisionSpace = async () => {
		signInAs(owner);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Sharing space" },
				useCase: 2,
			})
		).json();
		return spaceId as string;
	};

	const spaceViewAccessType = async (spaceId: string) => {
		signInAs(owner);
		const body = await (
			await post("/api/command/ObjectSearchSubscribe", { subId: "space" })
		).json();
		const record = (body.records as any[]).find(
			(it) => it.targetSpaceId === spaceId,
		);
		return record ? Number(record.spaceAccessType) : null;
	};

	// The confirm popup derives the slots it can still hand out from the space view's seat limits
	// (popup/invite/confirm.tsx:67-68). When that subtraction is not a positive number it drops
	// Accept/Reject entirely and offers the hosted plan's "add more members" upsell instead — so a
	// self-hosted space that reports no seats leaves its owner unable to approve a join request from
	// the very notification that asks them to. A space here has no seat cap.
	const spaceViewSeats = async (spaceId: string) => {
		signInAs(owner);
		const body = await (
			await post("/api/command/ObjectSearchSubscribe", { subId: "space" })
		).json();
		const record = (body.records as any[]).find(
			(it) => it.targetSpaceId === spaceId,
		);
		return {
			readers: Number(record?.readersLimit),
			writers: Number(record?.writersLimit),
		};
	};

	const makeShareable = async (spaceId: string, as = owner) => {
		signInAs(as);
		return (await post("/api/command/SpaceMakeShareable", { spaceId })).json();
	};

	const stopSharing = async (spaceId: string, as = owner) => {
		signInAs(as);
		return (await post("/api/command/SpaceStopSharing", { spaceId })).json();
	};

	it("makes a space shareable and projects it into the space view", async () => {
		const spaceId = await provisionSpace();

		const body = await makeShareable(spaceId);
		expect(body.error).toEqual({ code: 0, description: "" });

		const row = await prisma.space.findUnique({ where: { id: spaceId } });
		expect(row?.spaceAccessType).toBe(2); // Shared

		expect(await spaceViewAccessType(spaceId)).toBe(2);
	});

	it("gives the space view room for more members", async () => {
		const spaceId = await provisionSpace();
		await makeShareable(spaceId);

		// The owner is the space's only member, so the client's subtraction is limit - 1.
		const members = await prisma.spaceMember.count({
			where: { spaceId, status: "active" },
		});
		expect(members).toBe(1);

		const seats = await spaceViewSeats(spaceId);
		expect(seats.readers - members).toBeGreaterThan(0);
		expect(seats.writers - members).toBeGreaterThan(0);
	});

	it("stops sharing, revoking the invite and returning the space to private", async () => {
		const spaceId = await provisionSpace();
		await makeShareable(spaceId);

		signInAs(owner);
		const made = await (
			await post("/api/command/SpaceInviteGenerate", {
				spaceId,
				inviteType: 0,
				permissions: 1,
				shareWithinSpace: false,
			})
		).json();

		const body = await stopSharing(spaceId);
		expect(body.error).toEqual({ code: 0, description: "" });

		const row = await prisma.space.findUnique({ where: { id: spaceId } });
		expect(row?.spaceAccessType).toBe(0); // Private

		const invite = await prisma.spaceInvite.findUnique({
			where: { cid: made.inviteCid },
		});
		expect(invite?.revoked).toBe(true);

		expect(await spaceViewAccessType(spaceId)).toBe(0);
	});

	it("refuses a member who is not the owner", async () => {
		const spaceId = await provisionSpace();
		await prisma.spaceMember.create({
			data: {
				spaceId,
				userId: admin,
				permission: "admin",
				status: "active",
			},
		});

		expect((await makeShareable(spaceId, admin)).error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
		expect((await stopSharing(spaceId, admin)).error).toEqual({
			code: 2,
			description: "Object access denied.",
		});

		const row = await prisma.space.findUnique({ where: { id: spaceId } });
		expect(row?.spaceAccessType).toBe(0);
	});
});
