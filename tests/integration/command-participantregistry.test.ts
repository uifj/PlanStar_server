import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// P2 object registry: on space open the shell subscribes to `participant-<spaceId>`
// (subscription.ts:755-766) and reads each member back through
// U.Space.getParticipant, whose id is `_participant_<spaceId>_<accountId>`
// (space.ts:476-478). Records must carry identity, the numeric
// participantPermissions and participantStatus the member UI reads, so the shim
// projects the space's real SpaceMember rows.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectSearchSubscribe participant registry",
	() => {
		const ownerId = "command-participants.owner";
		const writerId = "command-participants.writer";
		const joinerId = "command-participants.joiner";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Participants owner",
						email: "command-participants-owner@vanlife.test",
					},
					{
						id: writerId,
						name: "Participants writer",
						email: "command-participants-writer@vanlife.test",
					},
					{
						id: joinerId,
						name: "Participants joiner",
						email: "command-participants-joiner@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: ownerId } });
			await prisma.user.deleteMany({
				where: { id: { in: [ownerId, writerId, joinerId] } },
			});
		});

		it("lists the space's members as participant records", async () => {
			signInAs(ownerId);
			const { account } = await (
				await post("/api/command/AccountSelect", {})
			).json();
			const spaceId = account.info.accountSpaceId as string;

			await prisma.spaceMember.create({
				data: {
					spaceId,
					userId: writerId,
					permission: "writer",
					status: "active",
				},
			});

			const body = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `participant-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.counters.total).toBe(2);
			expect(body.records).toHaveLength(2);

			const byIdentity = Object.fromEntries(
				body.records.map((record: any) => [record.identity, record]),
			);

			const owner = byIdentity[ownerId];
			expect(owner).toBeDefined();
			// The id must be the one U.Space.getParticipantId derives, or
			// S.Detail.get(participantSubId, id) never resolves the current user.
			expect(owner.id).toBe(`_participant_${spaceId}_${ownerId}`);
			expect(owner.spaceId).toBe(spaceId);
			// ObjectLayout.Participant === 19.
			expect(owner.resolvedLayout).toBe(19);
			// ParticipantPermissions.Owner === 2, Active === 1.
			expect(owner.participantPermissions).toBe(2);
			expect(owner.participantStatus).toBe(1);
			expect(owner.name).toBe("Participants owner");

			const writer = byIdentity[writerId];
			expect(writer).toBeDefined();
			// ParticipantPermissions.Writer === 1.
			expect(writer.participantPermissions).toBe(1);
			expect(writer.participantStatus).toBe(1);
		});

		// A WithApprove invite leaves the requester in 'joining' (command-spaceinvite-join). The
		// members sheet's Request tab reads pending requests through this same subscription, filtering
		// getParticipantsList([Active, Joining]) by isJoining, so a joining member must project as
		// ParticipantStatus.Joining (0) rather than fall through to Active.
		it("projects a pending join request as a Joining participant", async () => {
			signInAs(ownerId);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Requests space" },
					useCase: 2,
				})
			).json();

			await prisma.spaceMember.create({
				data: {
					spaceId,
					userId: joinerId,
					permission: "writer",
					status: "joining",
				},
			});

			const body = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `participant-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });

			const byIdentity = Object.fromEntries(
				body.records.map((record: any) => [record.identity, record]),
			);
			const request = byIdentity[joinerId];
			expect(request).toBeDefined();
			expect(request.id).toBe(`_participant_${spaceId}_${joinerId}`);
			// ParticipantStatus.Joining === 0; the invited Writer permission rides along as the
			// suggested role the approver confirms.
			expect(request.participantStatus).toBe(0);
			expect(request.participantPermissions).toBe(1);
			expect(request.name).toBe("Participants joiner");
		});
	},
);
