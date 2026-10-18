import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The invitee half of sharing. SpaceInviteView { inviteCid, inviteFileKey } resolves a link to the
// space's public preview (response.ts:726 -> spaceId, spaceName, iconImage<-spaceIconCid,
// creatorName, creatorIcon<-creatorIconCid, inviteType, iconOption<-spaceIconOption, spaceType);
// it is called by a NON-member, so it is gated by possession of a live cid/key, not membership.
// SpaceJoin { networkId, spaceId, inviteCid, inviteFileKey } then branches on the invite's type
// (popup/invite/request.tsx:21): a WithoutApprove invite enrols the caller as an active SpaceMember
// at the invite's permissions, while a WithApprove invite only files a pending 'joining' request that
// a moderator later resolves with SpaceRequestApprove/SpaceRequestDecline.
describe.skipIf(!databaseAvailable)("space invite view + join", () => {
	const owner = "invite-join.owner";
	const joiner = "invite-join.joiner";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: owner,
					name: "Join owner",
					email: "invite-join-owner@vanlife.test",
				},
				{
					id: joiner,
					name: "Join joiner",
					email: "invite-join-joiner@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: owner } });
		await prisma.user.deleteMany({
			where: { id: { in: [owner, joiner] } },
		});
	});

	const provisionSpace = async (name = "Joinable space") => {
		signInAs(owner);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name },
				useCase: 2,
			})
		).json();
		return spaceId as string;
	};

	const generate = async (spaceId: string, permissions = 1, inviteType = 0) => {
		signInAs(owner);
		const body = await (
			await post("/api/command/SpaceInviteGenerate", {
				spaceId,
				inviteType,
				permissions,
				shareWithinSpace: false,
			})
		).json();
		return { cid: body.inviteCid as string, key: body.inviteFileKey as string };
	};

	const view = async (cid: string, key: string, as = joiner) => {
		signInAs(as);
		return (
			await post("/api/command/SpaceInviteView", {
				inviteCid: cid,
				inviteFileKey: key,
			})
		).json();
	};

	const join = async (
		spaceId: string,
		cid: string,
		key: string,
		as = joiner,
	) => {
		signInAs(as);
		return (
			await post("/api/command/SpaceJoin", {
				networkId: "self-hosted",
				spaceId,
				inviteCid: cid,
				inviteFileKey: key,
			})
		).json();
	};

	it("resolves a live invite to the space preview for a non-member", async () => {
		const spaceId = await provisionSpace("Preview space");
		const { cid, key } = await generate(spaceId, 1);

		const body = await view(cid, key);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.spaceId).toBe(spaceId);
		expect(body.spaceName).toBe("Preview space");
		expect(body.creatorName).toBe("Join owner");
		expect(body.inviteType).toBe(0);
	});

	it("answers NOT_FOUND for an unknown invite", async () => {
		const body = await view("no-such-cid", "no-such-key");
		expect(body.error).toEqual({ code: 3, description: "Object not found." });
	});

	it("answers NOT_FOUND for a revoked invite", async () => {
		const spaceId = await provisionSpace();
		const { cid, key } = await generate(spaceId, 1);

		signInAs(owner);
		await post("/api/command/SpaceInviteRevoke", { spaceId });

		const body = await view(cid, key);
		expect(body.error).toEqual({ code: 3, description: "Object not found." });
	});

	it("enrols the caller as an active member at the invite permissions", async () => {
		const spaceId = await provisionSpace();
		const { cid, key } = await generate(spaceId, 1, 2); // 2 = WithoutApprove, 1 = Writer

		const body = await join(spaceId, cid, key);
		expect(body.error).toEqual({ code: 0, description: "" });

		const member = await prisma.spaceMember.findUnique({
			where: { spaceId_userId: { spaceId, userId: joiner } },
		});
		expect(member).not.toBeNull();
		expect(member?.status).toBe("active");
		expect(member?.permission).toBe("writer");
	});

	it("files a pending join request for a WithApprove invite, not an active member", async () => {
		const spaceId = await provisionSpace();
		const { cid, key } = await generate(spaceId, 1, 0); // 0 = WithApprove, 1 = Writer

		const body = await join(spaceId, cid, key);
		expect(body.error).toEqual({ code: 0, description: "" });

		const member = await prisma.spaceMember.findUnique({
			where: { spaceId_userId: { spaceId, userId: joiner } },
		});
		expect(member).not.toBeNull();
		// The requester is NOT let in yet: they sit in 'joining' until a moderator approves, and the
		// invited permission rides along as the suggested role the approver confirms.
		expect(member?.status).toBe("joining");
		expect(member?.permission).toBe("writer");
	});

	it("refuses to join through a revoked invite", async () => {
		const spaceId = await provisionSpace();
		const { cid, key } = await generate(spaceId, 1);

		signInAs(owner);
		await post("/api/command/SpaceInviteRevoke", { spaceId });

		const body = await join(spaceId, cid, key);
		expect(body.error.code).not.toBe(0);

		const member = await prisma.spaceMember.findUnique({
			where: { spaceId_userId: { spaceId, userId: joiner } },
		});
		expect(member).toBeNull();
	});

	it("is idempotent when the caller is already a member", async () => {
		const spaceId = await provisionSpace();
		const { cid, key } = await generate(spaceId, 1, 2);

		await join(spaceId, cid, key);
		const again = await join(spaceId, cid, key);
		expect(again.error).toEqual({ code: 0, description: "" });

		const count = await prisma.spaceMember.count({
			where: { spaceId, userId: joiner },
		});
		expect(count).toBe(1);
	});
});
