import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The moderator half of the WithApprove share flow. A pending request surfaces in the members sheet's
// Request tab (command-participantregistry projects it as ParticipantStatus.Joining); the owner/admin
// resolves it there or from the invite-confirm popup:
//   SpaceRequestApprove { spaceId, identity, permissions } -> the requester becomes an active member
//     at the role the moderator picked (members.tsx:178, popup/invite/confirm.tsx:23).
//   SpaceRequestDecline { spaceId, identity } -> the request is withdrawn and leaves the tab
//     (members.tsx:163, confirm.tsx:41).
// Both are moderator actions (canModerate = owner/admin), so a writer is below the floor.
describe.skipIf(!databaseAvailable)("space join-request moderation", () => {
	const owner = "request.owner";
	const writer = "request.writer";
	const requester = "request.requester";

	const pid = (spaceId: string, userId: string) =>
		`_participant_${spaceId.replace(/\./g, "_")}_${userId}`;

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: owner,
					name: "Request owner",
					email: "request-owner@vanlife.test",
				},
				{
					id: writer,
					name: "Request writer",
					email: "request-writer@vanlife.test",
				},
				{
					id: requester,
					name: "Request requester",
					email: "request-requester@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: owner } });
		await prisma.user.deleteMany({
			where: { id: { in: [owner, writer, requester] } },
		});
	});

	const provision = async () => {
		signInAs(owner);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Requests space" },
				useCase: 2,
			})
		).json();
		return spaceId as string;
	};

	const seedMember = async (
		spaceId: string,
		userId: string,
		permission: "reader" | "writer" | "admin",
		status: "active" | "joining",
	) => {
		await prisma.spaceMember.create({
			data: { spaceId, userId, permission, status },
		});
	};

	const approve = async (
		spaceId: string,
		identity: string,
		permissions: number,
		as = owner,
	) => {
		signInAs(as);
		return (
			await post("/api/command/SpaceRequestApprove", {
				spaceId,
				identity,
				permissions,
			})
		).json();
	};

	const decline = async (spaceId: string, identity: string, as = owner) => {
		signInAs(as);
		return (
			await post("/api/command/SpaceRequestDecline", { spaceId, identity })
		).json();
	};

	it("approves a pending request, making the requester an active member at the chosen role", async () => {
		const spaceId = await provision();
		await seedMember(spaceId, requester, "writer", "joining");

		// The moderator picks the final role (4 = Admin), overriding the invited suggestion.
		const body = await approve(spaceId, pid(spaceId, requester), 4);
		expect(body.error).toEqual({ code: 0, description: "" });

		const member = await prisma.spaceMember.findUnique({
			where: { spaceId_userId: { spaceId, userId: requester } },
		});
		expect(member?.status).toBe("active");
		expect(member?.permission).toBe("admin");
	});

	it("refuses a moderator below the admin floor", async () => {
		const spaceId = await provision();
		await seedMember(spaceId, writer, "writer", "active");
		await seedMember(spaceId, requester, "writer", "joining");

		const body = await approve(spaceId, pid(spaceId, requester), 1, writer);
		expect(body.error.code).toBe(2);

		const member = await prisma.spaceMember.findUnique({
			where: { spaceId_userId: { spaceId, userId: requester } },
		});
		expect(member?.status).toBe("joining");
	});

	it("answers NOT_FOUND when the identity has no pending request", async () => {
		const spaceId = await provision();
		await seedMember(spaceId, writer, "writer", "active");

		// An already-active member is not a request: approving must not touch their role.
		const body = await approve(spaceId, pid(spaceId, writer), 4);
		expect(body.error).toEqual({ code: 3, description: "Object not found." });

		const member = await prisma.spaceMember.findUnique({
			where: { spaceId_userId: { spaceId, userId: writer } },
		});
		expect(member?.status).toBe("active");
		expect(member?.permission).toBe("writer");
	});

	it("declines a pending request, removing it from the roster", async () => {
		const spaceId = await provision();
		await seedMember(spaceId, requester, "writer", "joining");

		const body = await decline(spaceId, pid(spaceId, requester));
		expect(body.error).toEqual({ code: 0, description: "" });

		// A declined requester was never a member, so no row survives to haunt the roster.
		const member = await prisma.spaceMember.findUnique({
			where: { spaceId_userId: { spaceId, userId: requester } },
		});
		expect(member).toBeNull();
	});

	it("refuses a decline from a moderator below the admin floor", async () => {
		const spaceId = await provision();
		await seedMember(spaceId, writer, "writer", "active");
		await seedMember(spaceId, requester, "writer", "joining");

		const body = await decline(spaceId, pid(spaceId, requester), writer);
		expect(body.error.code).toBe(2);

		const member = await prisma.spaceMember.findUnique({
			where: { spaceId_userId: { spaceId, userId: requester } },
		});
		expect(member?.status).toBe("joining");
	});

	it("answers NOT_FOUND when declining an identity that is not a pending request", async () => {
		const spaceId = await provision();
		await seedMember(spaceId, writer, "writer", "active");

		// Declining an active member must not remove them: only a 'joining' request can be declined.
		const body = await decline(spaceId, pid(spaceId, writer));
		expect(body.error).toEqual({ code: 3, description: "Object not found." });

		const member = await prisma.spaceMember.findUnique({
			where: { spaceId_userId: { spaceId, userId: writer } },
		});
		expect(member?.status).toBe("active");
	});
});
