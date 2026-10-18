import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The client resolves a person, not a user id, for every ownership decision: U.Space.getMyParticipant
// reads `_participant_<spaceId>_<accountId>` out of the `subSpace-<spaceId>` subscription, and
// isMyOwner / canManageInvite / canMyParticipantModerate / canMyParticipantWrite all return false (or
// null) when that record is missing. So the share sheet, the member-management controls and the Bin
// entry are all gated on this subscription answering. U.Subscription.createSubSpace sends it as an
// `id In [creator, my participant, homepage]` filter, and the same store resolves the homepage object
// (U.Space.getDashboardObject) and the space creator's name.
describe.skipIf(!databaseAvailable)("subspace subscription", () => {
	const owner = "subspace-owner";
	const reader = "subspace-reader";
	const outsider = "subspace-outsider";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: owner,
					name: "Subspace owner",
					email: "subspace-owner@vanlife.test",
				},
				{
					id: reader,
					name: "Subspace reader",
					email: "subspace-reader@vanlife.test",
				},
				{
					id: outsider,
					name: "Subspace outsider",
					email: "subspace-outsider@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: owner } });
		await prisma.user.deleteMany({
			where: { id: { in: [owner, reader, outsider] } },
		});
	});

	// The client derives the id the same way (U.Space.getParticipantId), dots in the space id included.
	const participantOf = (spaceId: string, userId: string) =>
		`_participant_${spaceId.replace(/\./g, "_")}_${userId}`;

	const provisionSpace = async () => {
		signInAs(owner);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Subspace space" },
				useCase: 2,
			})
		).json();
		return spaceId as string;
	};

	const subscribe = async (spaceId: string, ids: string[], as = owner) => {
		signInAs(as);
		return (
			await post("/api/command/ObjectSearchSubscribe", {
				spaceId,
				subId: `subSpace-${spaceId}`,
				filters: [{ RelationKey: "id", condition: 9, value: ids }],
				keys: ["id", "name", "participantPermissions", "identity", "homepage"],
			})
		).json();
	};

	it("answers the caller's participant record so the client can read ownership", async () => {
		const spaceId = await provisionSpace();

		const body = await subscribe(spaceId, [participantOf(spaceId, owner)]);
		expect(body.error).toEqual({ code: 0, description: "" });

		const record = (body.records as any[]).find(
			(it) => it.id === participantOf(spaceId, owner),
		);
		expect(record).toBeTruthy();
		expect(record.name).toBe("Subspace owner");
		expect(record.identity).toBe(owner);
		expect(record.participantPermissions).toBe(2); // Owner
		expect(record.resolvedLayout).toBe(19); // Participant
	});

	it("keeps the other members out of a space the caller does not belong to", async () => {
		const spaceId = await provisionSpace();

		const body = await subscribe(
			spaceId,
			[participantOf(spaceId, owner)],
			outsider,
		);

		expect(body.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
		expect(body.records || []).toEqual([]);
	});

	it("hydrates a requested object alongside the participants, in the requested order", async () => {
		const spaceId = await provisionSpace();
		signInAs(owner);
		const { objectId } = await (
			await post("/api/command/ObjectCreate", {
				spaceId,
				details: { name: "Homepage" },
			})
		).json();

		await prisma.spaceMember.create({
			data: { spaceId, userId: reader, permission: "reader", status: "active" },
		});

		const body = await subscribe(spaceId, [
			participantOf(spaceId, owner),
			objectId,
			participantOf(spaceId, reader),
			"missing-id",
		]);

		expect((body.records as any[]).map((it) => it.id)).toEqual([
			participantOf(spaceId, owner),
			objectId,
			participantOf(spaceId, reader),
		]);
		expect((body.records as any[])[1].name).toBe("Homepage");
	});

	// U.Space.getCreator(spaceId, spaceview.creator) reads the creator out of this same store, so the
	// space view must name the person by participant id — and by the space's own creator, not by the
	// member who happens to be looking at the vault.
	it("names the space creator by participant id, resolvable from the same store", async () => {
		const spaceId = await provisionSpace();
		await prisma.spaceMember.create({
			data: { spaceId, userId: reader, permission: "reader", status: "active" },
		});

		signInAs(reader);
		const vault = await (
			await post("/api/command/ObjectSearchSubscribe", { subId: "space" })
		).json();
		const spaceView = (vault.records as any[]).find(
			(it) => it.targetSpaceId === spaceId,
		);
		expect(spaceView.creator).toBe(participantOf(spaceId, owner));

		const body = await subscribe(spaceId, [spaceView.creator], reader);
		expect((body.records as any[]).map((it) => it.id)).toEqual([
			participantOf(spaceId, owner),
		]);
		expect((body.records as any[])[0].name).toBe("Subspace owner");
	});
});
