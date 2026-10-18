import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// SpaceInviteGenerate backs the space share sheet (settings/space/share.tsx): an owner or admin
// mints a link the client addresses by an Anytype-style cid + fileKey pair. The wire request is
// { spaceId, inviteType, permissions, shareWithinSpace } (command.ts) and the response is read as
// { inviteCid, inviteFileKey, inviteType, permissions } (response.ts:707). The self-hosted backend
// stores that pair on a SpaceInvite row rather than publishing an off-chain invite file.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/SpaceInviteGenerate",
	() => {
		const owner = "invite.owner";
		const outsider = "invite.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Invite owner",
						email: "invite-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Invite outsider",
						email: "invite-outsider@vanlife.test",
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
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Invite space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		const generate = async (
			spaceId: string,
			opts: { inviteType?: number; permissions?: number } = {},
			as = owner,
		) => {
			signInAs(as);
			return (
				await post("/api/command/SpaceInviteGenerate", {
					spaceId,
					inviteType: opts.inviteType ?? 0,
					permissions: opts.permissions ?? 0,
					shareWithinSpace: false,
				})
			).json();
		};

		it("mints a shareable invite and persists it for the space", async () => {
			const spaceId = await provisionSpace();

			const body = await generate(spaceId, { inviteType: 0, permissions: 1 });
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(typeof body.inviteCid).toBe("string");
			expect(body.inviteCid.length).toBeGreaterThan(0);
			expect(typeof body.inviteFileKey).toBe("string");
			expect(body.inviteFileKey.length).toBeGreaterThan(0);
			expect(body.inviteType).toBe(0);
			expect(body.permissions).toBe(1);

			// Real DB read-back: the cid/fileKey pair the client will hand out resolves to a live,
			// non-revoked SpaceInvite owned by the caller, scoped to this space.
			const row = await prisma.spaceInvite.findUnique({
				where: { cid: body.inviteCid },
			});
			expect(row).not.toBeNull();
			expect(row?.spaceId).toBe(spaceId);
			expect(row?.fileKey).toBe(body.inviteFileKey);
			expect(row?.inviteType).toBe(0);
			expect(row?.permissions).toBe(1);
			expect(row?.revoked).toBe(false);
			expect(row?.createdBy).toBe(owner);
		});

		it("refuses a member below the admin floor from minting an invite", async () => {
			const spaceId = await provisionSpace();

			// A writer is a real member but sits below Anytype's owner/admin share gate, so the wire
			// must refuse rather than hand out a link.
			await prisma.spaceMember.create({
				data: {
					spaceId,
					userId: outsider,
					permission: "writer",
					status: "active",
				},
			});

			const body = await generate(spaceId, {}, outsider);
			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});

			const rows = await prisma.spaceInvite.count({ where: { spaceId } });
			expect(rows).toBe(0);
		});

		it("retires the prior invite so a space holds one current link", async () => {
			const spaceId = await provisionSpace();

			const first = await generate(spaceId, { permissions: 0 });
			const second = await generate(spaceId, { permissions: 1 });

			expect(second.inviteCid).not.toBe(first.inviteCid);

			// SpaceInviteGetCurrent/Revoke act on the single live invite, so re-minting must revoke the
			// old row: exactly one non-revoked invite survives, and it is the newest.
			const live = await prisma.spaceInvite.findMany({
				where: { spaceId, revoked: false },
			});
			expect(live).toHaveLength(1);
			expect(live[0].cid).toBe(second.inviteCid);

			const stale = await prisma.spaceInvite.findUnique({
				where: { cid: first.inviteCid },
			});
			expect(stale?.revoked).toBe(true);
		});
	},
);
