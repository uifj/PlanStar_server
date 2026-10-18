import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// P2 space lifecycle: Action's delete confirmation calls C.SpaceDelete(spaceId) for
// both owners ("Delete") and other members ("Leave") (action.ts:808-816). The shim
// must delete the whole space for its owner and only drop the membership for anyone
// else, and must deny a caller who is not a member at all.
describe.skipIf(!databaseAvailable)("POST /api/command/SpaceDelete", () => {
	const ownerId = "command-spacedelete.owner";
	const writerId = "command-spacedelete.writer";
	const outsiderId = "command-spacedelete.outsider";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: ownerId,
					name: "Delete owner",
					email: "command-spacedelete-owner@vanlife.test",
				},
				{
					id: writerId,
					name: "Delete writer",
					email: "command-spacedelete-writer@vanlife.test",
				},
				{
					id: outsiderId,
					name: "Delete outsider",
					email: "command-spacedelete-outsider@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: ownerId } });
		await prisma.user.deleteMany({
			where: { id: { in: [ownerId, writerId, outsiderId] } },
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

	it("deletes the whole space when the owner asks", async () => {
		const spaceId = await createSpace("Doomed");

		signInAs(ownerId);
		const deleted = await (
			await post("/api/command/SpaceDelete", { spaceId })
		).json();
		expect(deleted.error).toEqual({ code: 0, description: "" });

		expect(
			await prisma.space.findUnique({ where: { id: spaceId } }),
		).toBeNull();

		const sub = await (
			await post("/api/command/ObjectSearchSubscribe", {
				subId: "space",
				filters: [],
				sorts: [],
				keys: [],
			})
		).json();
		expect(
			sub.records.find((it: any) => it.targetSpaceId === spaceId),
		).toBeUndefined();
	});

	it("only removes the membership when a non-owner leaves", async () => {
		const spaceId = await createSpace("Shared");
		await prisma.spaceMember.create({
			data: {
				spaceId,
				userId: writerId,
				permission: "writer",
				status: "active",
			},
		});

		signInAs(writerId);
		const left = await (
			await post("/api/command/SpaceDelete", { spaceId })
		).json();
		expect(left.error).toEqual({ code: 0, description: "" });

		expect(
			await prisma.spaceMember.findFirst({
				where: { spaceId, userId: writerId },
			}),
		).toBeNull();
		// The space and its owner survive a member leaving.
		expect(
			await prisma.space.findUnique({ where: { id: spaceId } }),
		).not.toBeNull();
		expect(
			await prisma.spaceMember.findFirst({
				where: { spaceId, userId: ownerId },
			}),
		).not.toBeNull();
	});

	it("denies a caller who is not a member", async () => {
		const spaceId = await createSpace("Fortress");

		signInAs(outsiderId);
		const res = await post("/api/command/SpaceDelete", { spaceId });
		const body = await res.json();
		expect(body.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});

		expect(
			await prisma.space.findUnique({ where: { id: spaceId } }),
		).not.toBeNull();
	});
});
