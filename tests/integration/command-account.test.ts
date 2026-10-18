import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../../src/config/env.js";
import { prisma } from "../../src/lib/prisma.js";
import { signedOut, signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The vendored Anytype shell speaks one transport: ClientCommands. The command
// shim answers those commands over the session cookie so the shell's dispatcher
// and Response mappers run untouched. AccountSelect is the render gate — it sets
// S.Auth.account — so it is the first command the shim must satisfy with real data.
describe.skipIf(!databaseAvailable)("POST /command/:name", () => {
	const userId = "command-account.owner";

	beforeAll(async () => {
		await prisma.user.create({
			data: {
				id: userId,
				name: "Command owner",
				email: "command-account@vanlife.test",
			},
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: userId } });
		await prisma.user.deleteMany({ where: { id: userId } });
	});

	it("returns a real account bound to the caller's space", async () => {
		signInAs(userId);

		const response = await post("/api/command/AccountSelect", {});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.account.id).toBe(userId);
		// Raw proto envelope: the shell's mapper reads statusType/deletionDate.
		expect(body.account.status.statusType).toBe(0);

		const info = body.account.info;
		const space = await prisma.space.findUnique({
			where: { id: info.accountSpaceId },
		});
		expect(space?.createdBy).toBe(userId);

		// The client builds file/image URLs as `<gatewayUrl>/file/<id>` (store/common.ts
		// fileUrl), so the gateway must be the API base the serve routes are mounted on.
		expect(info.gatewayUrl).toBe(`${env.APP_URL}/api`);

		for (const id of [info.profileObjectId, info.spaceViewId, info.widgetsId]) {
			const object = await prisma.obj.findUnique({ where: { id } });
			expect(object?.spaceId).toBe(info.accountSpaceId);
		}
	});

	it("provisions the same account on every call", async () => {
		signInAs(userId);

		const first = await (await post("/api/command/AccountSelect", {})).json();
		const second = await (await post("/api/command/AccountSelect", {})).json();

		expect(second.account.info.accountSpaceId).toBe(
			first.account.info.accountSpaceId,
		);
		expect(second.account.info.spaceViewId).toBe(
			first.account.info.spaceViewId,
		);
		expect(second.account.info.widgetsId).toBe(first.account.info.widgetsId);

		// The system objects carry their layout inside details; the default type mirrors the boot
		// installs have their own layout column, so they are not counted here.
		const systemObjects = await prisma.obj.findMany({
			where: {
				spaceId: first.account.info.accountSpaceId,
				layout: null,
			},
			select: { details: true },
		});
		expect(
			systemObjects
				.map((it) => (it.details as { layout: string }).layout)
				.sort(),
		).toEqual(["chat", "profile", "spaceView", "widgets"]);
	});

	it("answers an unknown command with an error envelope", async () => {
		signInAs(userId);

		const response = await post("/api/command/NotARealCommand", {});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.error.code).not.toBe(0);
	});

	// After AccountSelect the shell runs U.Router.switchSpace, which must reach
	// openDashboard() -> /main/void/empty. That success path needs WorkspaceOpen to
	// return the space info and the global "space" subscription to hand back an
	// active spaceview record; every other subscription may be empty.
	it("opens the space and lists an active spaceview for the shell boot", async () => {
		signInAs(userId);
		const { account } = await (
			await post("/api/command/AccountSelect", {})
		).json();
		const spaceId = account.info.accountSpaceId;

		const opened = await (
			await post("/api/command/WorkspaceOpen", { spaceId })
		).json();
		expect(opened.error.code).toBe(0);
		expect(opened.info.accountSpaceId).toBe(spaceId);
		expect(opened.info.spaceViewId).toBe(account.info.spaceViewId);

		const spaceSub = await (
			await post("/api/command/ObjectSearchSubscribe", {
				spaceId,
				subId: "space",
				filters: [],
				sorts: [],
				keys: [],
			})
		).json();
		expect(spaceSub.error.code).toBe(0);
		expect(spaceSub.records).toHaveLength(1);
		const spaceview = spaceSub.records[0];
		expect(spaceview.id).toBe(account.info.spaceViewId);
		expect(spaceview.targetSpaceId).toBe(spaceId);
		// ObjectLayout.SpaceView === 18; AccountStatus Active/Ok keep it auto-openable.
		expect(spaceview.resolvedLayout).toBe(18);
		expect([0, 8]).toContain(spaceview.spaceAccountStatus);
		expect([0, 2]).toContain(spaceview.spaceLocalStatus);

		const otherSub = await (
			await post("/api/command/ObjectSearchSubscribe", {
				spaceId,
				subId: "typeStore",
				filters: [],
				sorts: [],
				keys: [],
			})
		).json();
		expect(otherSub.error.code).toBe(0);
		expect(otherSub.records).toEqual([]);

		const unsubscribed = await (
			await post("/api/command/ObjectSearchUnsubscribe", {
				subIds: ["typeStore"],
			})
		).json();
		expect(unsubscribed.error.code).toBe(0);

		const openedWidgets = await (
			await post("/api/command/ObjectOpen", {
				objectId: account.info.widgetsId,
				spaceId,
			})
		).json();
		expect(openedWidgets.error.code).toBe(0);
		expect(openedWidgets.objectView.rootId).toBe(account.info.widgetsId);
	});

	it("rejects a caller without a session", async () => {
		signedOut();

		const response = await post("/api/command/AccountSelect", {});

		expect(response.status).toBe(401);
	});
});
