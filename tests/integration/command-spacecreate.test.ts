import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// P2 space lifecycle: the create popup issues WorkspaceCreate(details, useCase) and
// reads the new space id off the response (response.ts:615-620 maps spaceId ->
// objectId), then WorkspaceSetInfo(spaceId, details) to apply the name, then
// U.Router.switchSpace -> WorkspaceOpen(spaceId) (create.tsx:223-238,
// space.ts:163-208). For the new space to show in the vault and be switchable, the
// shim must create a real Space the caller owns and list it in the global "space"
// subscription.
describe.skipIf(!databaseAvailable)("POST /api/command/WorkspaceCreate", () => {
	const userId = "command-spacecreate.owner";
	const outsiderId = "command-spacecreate.outsider";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: userId,
					name: "Space creator",
					email: "command-spacecreate@vanlife.test",
				},
				{
					id: outsiderId,
					name: "Space outsider",
					email: "command-spacecreate-outsider@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: userId } });
		await prisma.user.deleteMany({
			where: { id: { in: [userId, outsiderId] } },
		});
	});

	it("creates a real space owned by the caller", async () => {
		signInAs(userId);

		const response = await post("/api/command/WorkspaceCreate", {
			details: { name: "Road Trip" },
			useCase: 2,
		});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(typeof body.spaceId).toBe("string");

		const space = await prisma.space.findUnique({ where: { id: body.spaceId } });
		expect(space?.createdBy).toBe(userId);
		expect(space?.name).toBe("Road Trip");

		const member = await prisma.spaceMember.findFirst({
			where: { spaceId: body.spaceId, userId },
		});
		expect(member?.permission).toBe("owner");
		expect(member?.status).toBe("active");

		// The space boots with the same three system objects AccountSelect provisions.
		const systemObjects = await prisma.obj.count({
			where: { spaceId: body.spaceId },
		});
		expect(systemObjects).toBe(3);
	});

	it("renames the space and lists it in the global space subscription", async () => {
		signInAs(userId);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Scratch" },
				useCase: 2,
			})
		).json();

		const setInfo = await (
			await post("/api/command/WorkspaceSetInfo", {
				spaceId,
				details: { name: "Mountain Loop" },
			})
		).json();
		expect(setInfo.error).toEqual({ code: 0, description: "" });

		const space = await prisma.space.findUnique({ where: { id: spaceId } });
		expect(space?.name).toBe("Mountain Loop");

		const sub = await (
			await post("/api/command/ObjectSearchSubscribe", {
				spaceId,
				subId: "space",
				filters: [],
				sorts: [],
				keys: [],
			})
		).json();
		expect(sub.error).toEqual({ code: 0, description: "" });

		const record = sub.records.find(
			(it: any) => it.targetSpaceId === spaceId,
		);
		expect(record).toBeDefined();
		expect(record.name).toBe("Mountain Loop");
		// ObjectLayout.SpaceView === 18; auto-openable statuses.
		expect(record.resolvedLayout).toBe(18);
		expect([0, 8]).toContain(record.spaceAccountStatus);
		expect([0, 2]).toContain(record.spaceLocalStatus);
	});

	it("denies renaming a space the caller does not belong to", async () => {
		signInAs(userId);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Private" },
				useCase: 2,
			})
		).json();

		signInAs(outsiderId);
		const res = await post("/api/command/WorkspaceSetInfo", {
			spaceId,
			details: { name: "Hijacked" },
		});
		const body = await res.json();
		expect(body.error).toEqual({ code: 2, description: "Object access denied." });

		const space = await prisma.space.findUnique({ where: { id: spaceId } });
		expect(space?.name).toBe("Private");
	});
});
