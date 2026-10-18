import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// Slice B of #199: the member flows GENERATE notifications, which NotificationList then reads back.
// Each flow has a distinct recipient and payload, derived from the client's display text
// (model/notification.ts) and the wire shape From.Notification reads (mapper.ts:536):
//   SpaceJoin on a WithApprove invite files a request -> the space OWNER(S) get requestToJoin naming
//     the joiner { spaceId, spaceName, identity, identityName, identityIcon }.
//   SpaceRequestApprove -> the REQUESTER gets participantRequestApproved { spaceId, spaceName,
//     permissions } where permissions is the wire NUMBER the moderator picked.
//   SpaceRequestDecline -> the REQUESTER gets participantRequestDecline { spaceId, spaceName }.
//   SpaceParticipantPermissionsChange -> the AFFECTED member gets participantPermissionsChange
//     { spaceId, spaceName, permissions }.
//   SpaceParticipantRemove -> the REMOVED member gets participantRemove { spaceId, spaceName,
//     identity, identityName, identityIcon } (display uses spaceName only; identity rides along).
// The moderator for every flow is the space owner (WorkspaceCreate makes the creator an active owner).
describe.skipIf(!databaseAvailable)("notification generation", () => {
	const owner = "notify-gen.owner";
	const requester = "notify-gen.requester";
	const member = "notify-gen.member";
	const joiner = "notify-gen.joiner";
	const users = [owner, requester, member, joiner];

	const pid = (spaceId: string, userId: string) =>
		`_participant_${spaceId.replace(/\./g, "_")}_${userId}`;

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: owner,
					name: "Gen owner",
					email: "notify-gen-owner@vanlife.test",
				},
				{
					id: requester,
					name: "Gen requester",
					email: "notify-gen-requester@vanlife.test",
				},
				{
					id: member,
					name: "Gen member",
					email: "notify-gen-member@vanlife.test",
				},
				{
					id: joiner,
					name: "Gen joiner",
					email: "notify-gen-joiner@vanlife.test",
				},
			],
		});
	});

	// Every test provisions its own space, so clear the file's notifications between tests to keep each
	// recipient's list to exactly the one this flow generates.
	beforeEach(async () => {
		await prisma.notification.deleteMany({
			where: { userId: { in: users } },
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: owner } });
		await prisma.user.deleteMany({ where: { id: { in: users } } });
	});

	const provision = async (name: string) => {
		signInAs(owner);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name },
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

	const list = async (as: string) => {
		signInAs(as);
		return (
			await post("/api/command/NotificationList", {
				includeRead: true,
				limit: 50,
			})
		).json();
	};

	const approve = async (
		spaceId: string,
		identity: string,
		permissions: number,
	) => {
		signInAs(owner);
		return (
			await post("/api/command/SpaceRequestApprove", {
				spaceId,
				identity,
				permissions,
			})
		).json();
	};

	const decline = async (spaceId: string, identity: string) => {
		signInAs(owner);
		return (
			await post("/api/command/SpaceRequestDecline", { spaceId, identity })
		).json();
	};

	const changePerms = async (
		spaceId: string,
		identity: string,
		perms: number,
	) => {
		signInAs(owner);
		return (
			await post("/api/command/SpaceParticipantPermissionsChange", {
				spaceId,
				changes: [{ identity, perms }],
			})
		).json();
	};

	const remove = async (spaceId: string, identities: string[]) => {
		signInAs(owner);
		return (
			await post("/api/command/SpaceParticipantRemove", {
				spaceId,
				identities,
			})
		).json();
	};

	const generateInvite = async (spaceId: string) => {
		signInAs(owner);
		const body = await (
			await post("/api/command/SpaceInviteGenerate", {
				spaceId,
				inviteType: 0, // WithApprove: files a pending request rather than admitting at once
				permissions: 1,
				shareWithinSpace: false,
			})
		).json();
		return { cid: body.inviteCid as string, key: body.inviteFileKey as string };
	};

	const join = async (spaceId: string, cid: string, key: string) => {
		signInAs(joiner);
		return (
			await post("/api/command/SpaceJoin", {
				networkId: "self-hosted",
				spaceId,
				inviteCid: cid,
				inviteFileKey: key,
			})
		).json();
	};

	it("notifies the space owner when a join request is filed", async () => {
		const spaceId = await provision("Gen join space");
		const { cid, key } = await generateInvite(spaceId);

		const joined = await join(spaceId, cid, key);
		expect(joined.error).toEqual({ code: 0, description: "" });

		const body = await list(owner);
		expect(body.notifications).toHaveLength(1);
		expect(body.notifications[0].requestToJoin).toEqual({
			spaceId,
			spaceName: "Gen join space",
			identity: pid(spaceId, joiner),
			identityName: "Gen joiner",
			identityIcon: "",
		});
	});

	it("notifies the requester when their request is approved", async () => {
		const spaceId = await provision("Gen approve space");
		await seedMember(spaceId, requester, "writer", "joining");

		const body = await approve(spaceId, pid(spaceId, requester), 4);
		expect(body.error).toEqual({ code: 0, description: "" });

		const listed = await list(requester);
		expect(listed.notifications).toHaveLength(1);
		expect(listed.notifications[0].participantRequestApproved).toEqual({
			spaceId,
			spaceName: "Gen approve space",
			permissions: 4,
		});
	});

	it("notifies the requester when their request is declined", async () => {
		const spaceId = await provision("Gen decline space");
		await seedMember(spaceId, requester, "writer", "joining");

		const body = await decline(spaceId, pid(spaceId, requester));
		expect(body.error).toEqual({ code: 0, description: "" });

		const listed = await list(requester);
		expect(listed.notifications).toHaveLength(1);
		expect(listed.notifications[0].participantRequestDecline).toEqual({
			spaceId,
			spaceName: "Gen decline space",
		});
	});

	it("notifies a member when their permissions change", async () => {
		const spaceId = await provision("Gen perms space");
		await seedMember(spaceId, member, "writer", "active");

		const body = await changePerms(spaceId, pid(spaceId, member), 4);
		expect(body.error).toEqual({ code: 0, description: "" });

		const listed = await list(member);
		expect(listed.notifications).toHaveLength(1);
		expect(listed.notifications[0].participantPermissionsChange).toEqual({
			spaceId,
			spaceName: "Gen perms space",
			permissions: 4,
		});
	});

	it("notifies a member when they are removed", async () => {
		const spaceId = await provision("Gen remove space");
		await seedMember(spaceId, member, "writer", "active");

		const body = await remove(spaceId, [pid(spaceId, member)]);
		expect(body.error).toEqual({ code: 0, description: "" });

		const listed = await list(member);
		expect(listed.notifications).toHaveLength(1);
		expect(listed.notifications[0].participantRemove).toEqual({
			spaceId,
			spaceName: "Gen remove space",
			identity: pid(spaceId, member),
			identityName: "",
			identityIcon: "",
		});
	});
});
