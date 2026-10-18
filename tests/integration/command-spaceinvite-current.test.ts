import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The share sheet reads and mutates the space's single live invite:
//   SpaceInviteGetCurrent { spaceId } -> { inviteCid, inviteFileKey, inviteType, permissions,
//                                          heldByOwner } (response.ts:716)
//   SpaceInviteRevoke     { spaceId } -> error-only
//   SpaceInviteChange     { spaceId, permissions } -> error-only
// All three act on the one non-revoked SpaceInvite row and are gated at the owner/admin floor.
// heldByOwner is false here: unlike Anytype, the invite is stored server-side and readable by any
// moderator, so the client always renders the link from the returned cid/key.
describe.skipIf(!databaseAvailable)(
	"space invite current/revoke/change",
	() => {
		const owner = "invite-cur.owner";
		const writer = "invite-cur.writer";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Current owner",
						email: "invite-cur-owner@vanlife.test",
					},
					{
						id: writer,
						name: "Current writer",
						email: "invite-cur-writer@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({
				where: { id: { in: [owner, writer] } },
			});
		});

		const provisionSpace = async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Current invite space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		const generate = async (spaceId: string, permissions = 1) => {
			signInAs(owner);
			return (
				await post("/api/command/SpaceInviteGenerate", {
					spaceId,
					inviteType: 0,
					permissions,
					shareWithinSpace: false,
				})
			).json();
		};

		const getCurrent = async (spaceId: string, as = owner) => {
			signInAs(as);
			return (
				await post("/api/command/SpaceInviteGetCurrent", { spaceId })
			).json();
		};

		const revoke = async (spaceId: string, as = owner) => {
			signInAs(as);
			return (await post("/api/command/SpaceInviteRevoke", { spaceId })).json();
		};

		const change = async (spaceId: string, permissions: number, as = owner) => {
			signInAs(as);
			return (
				await post("/api/command/SpaceInviteChange", { spaceId, permissions })
			).json();
		};

		it("returns the live invite after it is generated", async () => {
			const spaceId = await provisionSpace();
			const made = await generate(spaceId, 1);

			const body = await getCurrent(spaceId);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.inviteCid).toBe(made.inviteCid);
			expect(body.inviteFileKey).toBe(made.inviteFileKey);
			expect(body.inviteType).toBe(0);
			expect(body.permissions).toBe(1);
			expect(body.heldByOwner).toBe(false);
		});

		it("returns an empty invite when the space has none", async () => {
			const spaceId = await provisionSpace();

			const body = await getCurrent(spaceId);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.inviteCid).toBe("");
			expect(body.inviteFileKey).toBe("");
		});

		it("revokes the current invite so it no longer resolves", async () => {
			const spaceId = await provisionSpace();
			const made = await generate(spaceId, 1);

			const revoked = await revoke(spaceId);
			expect(revoked.error).toEqual({ code: 0, description: "" });

			const row = await prisma.spaceInvite.findUnique({
				where: { cid: made.inviteCid },
			});
			expect(row?.revoked).toBe(true);

			const after = await getCurrent(spaceId);
			expect(after.inviteCid).toBe("");
		});

		it("changes the current invite permissions", async () => {
			const spaceId = await provisionSpace();
			const made = await generate(spaceId, 0);

			const changed = await change(spaceId, 2);
			expect(changed.error).toEqual({ code: 0, description: "" });

			const row = await prisma.spaceInvite.findUnique({
				where: { cid: made.inviteCid },
			});
			expect(row?.permissions).toBe(2);

			const after = await getCurrent(spaceId);
			expect(after.permissions).toBe(2);
		});

		it("refuses a member below the admin floor", async () => {
			const spaceId = await provisionSpace();
			await generate(spaceId, 1);

			await prisma.spaceMember.create({
				data: {
					spaceId,
					userId: writer,
					permission: "writer",
					status: "active",
				},
			});

			expect((await getCurrent(spaceId, writer)).error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
			expect((await revoke(spaceId, writer)).error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
			expect((await change(spaceId, 2, writer)).error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
