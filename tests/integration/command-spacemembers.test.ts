import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// Direct member management from the space members sheet (settings/space/members.tsx). The client
// addresses people by their participant id `_participant_<spaceId>_<accountId>` (registry-service
// participantId), which the backend reverses to a userId:
//   SpaceParticipantsAddList          { spaceId, identities[], permissions }
//   SpaceParticipantPermissionsChange { spaceId, changes: [{ identity, perms }] }
//   SpaceParticipantRemove            { spaceId, identities[] }
// All are owner/admin-gated and must never demote or remove the space's owner.
describe.skipIf(!databaseAvailable)("space member management", () => {
	const owner = "members.owner";
	const alice = "members.alice";
	const bob = "members.bob";
	const writer = "members.writer";

	const pid = (spaceId: string, userId: string) =>
		`_participant_${spaceId.replace(/\./g, "_")}_${userId}`;

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: owner,
					name: "Members owner",
					email: "members-owner@vanlife.test",
				},
				{ id: alice, name: "Alice", email: "members-alice@vanlife.test" },
				{ id: bob, name: "Bob", email: "members-bob@vanlife.test" },
				{ id: writer, name: "Writer", email: "members-writer@vanlife.test" },
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: owner } });
		await prisma.user.deleteMany({
			where: { id: { in: [owner, alice, bob, writer] } },
		});
	});

	const provisionSpace = async () => {
		signInAs(owner);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Members space" },
				useCase: 2,
			})
		).json();
		return spaceId as string;
	};

	const seedMember = async (
		spaceId: string,
		userId: string,
		permission: "reader" | "writer" | "admin",
	) => {
		await prisma.spaceMember.create({
			data: { spaceId, userId, permission, status: "active" },
		});
	};

	const member = (spaceId: string, userId: string) =>
		prisma.spaceMember.findUnique({
			where: { spaceId_userId: { spaceId, userId } },
		});

	it("adds participants by identity at the granted permissions", async () => {
		const spaceId = await provisionSpace();
		signInAs(owner);

		const body = await (
			await post("/api/command/SpaceParticipantsAddList", {
				spaceId,
				identities: [pid(spaceId, alice)],
				permissions: 1, // Writer
			})
		).json();
		expect(body.error).toEqual({ code: 0, description: "" });

		const row = await member(spaceId, alice);
		expect(row?.status).toBe("active");
		expect(row?.permission).toBe("writer");
	});

	it("changes a participant's permissions", async () => {
		const spaceId = await provisionSpace();
		await seedMember(spaceId, alice, "reader");
		signInAs(owner);

		const body = await (
			await post("/api/command/SpaceParticipantPermissionsChange", {
				spaceId,
				changes: [{ identity: pid(spaceId, alice), perms: 4 }], // Admin
			})
		).json();
		expect(body.error).toEqual({ code: 0, description: "" });

		const row = await member(spaceId, alice);
		expect(row?.permission).toBe("admin");
	});

	it("removes a participant", async () => {
		const spaceId = await provisionSpace();
		await seedMember(spaceId, bob, "writer");
		signInAs(owner);

		const body = await (
			await post("/api/command/SpaceParticipantRemove", {
				spaceId,
				identities: [pid(spaceId, bob)],
			})
		).json();
		expect(body.error).toEqual({ code: 0, description: "" });

		const row = await member(spaceId, bob);
		expect(row?.status).toBe("removed");
	});

	it("never removes or demotes the space owner", async () => {
		const spaceId = await provisionSpace();
		await seedMember(spaceId, alice, "admin");
		signInAs(owner);

		await post("/api/command/SpaceParticipantRemove", {
			spaceId,
			identities: [pid(spaceId, owner)],
		});
		await post("/api/command/SpaceParticipantPermissionsChange", {
			spaceId,
			changes: [{ identity: pid(spaceId, owner), perms: 0 }],
		});

		const row = await member(spaceId, owner);
		expect(row?.status).toBe("active");
		expect(row?.permission).toBe("owner");
	});

	it("refuses a member below the admin floor", async () => {
		const spaceId = await provisionSpace();
		await seedMember(spaceId, writer, "writer");
		signInAs(writer);

		const body = await (
			await post("/api/command/SpaceParticipantsAddList", {
				spaceId,
				identities: [pid(spaceId, alice)],
				permissions: 1,
			})
		).json();
		expect(body.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});

		const row = await member(spaceId, alice);
		expect(row).toBeNull();
	});

	it("transfers ownership and demotes the old owner", async () => {
		const spaceId = await provisionSpace();
		await seedMember(spaceId, alice, "admin");
		signInAs(owner);

		const body = await (
			await post("/api/command/SpaceChangeOwnership", {
				spaceId,
				newOwnerIdentity: pid(spaceId, alice),
				oldOwnerPermissions: 1, // Writer
			})
		).json();
		expect(body.error).toEqual({ code: 0, description: "" });

		expect((await member(spaceId, alice))?.permission).toBe("owner");
		expect((await member(spaceId, owner))?.permission).toBe("writer");
	});

	it("refuses ownership transfer to a non-member", async () => {
		const spaceId = await provisionSpace();
		signInAs(owner);

		const body = await (
			await post("/api/command/SpaceChangeOwnership", {
				spaceId,
				newOwnerIdentity: pid(spaceId, bob), // bob is not a member
				oldOwnerPermissions: 1,
			})
		).json();
		expect(body.error).toEqual({ code: 3, description: "Object not found." });

		// The caller is still the owner.
		expect((await member(spaceId, owner))?.permission).toBe("owner");
	});
});
