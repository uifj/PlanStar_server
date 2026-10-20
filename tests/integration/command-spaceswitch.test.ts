import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// P2 space lifecycle: U.Router.switchSpace calls C.WorkspaceOpen(spaceId) and reads
// message.info to re-point the whole shell at the chosen space (router.ts:229-264,
// data.ts:392-403). The shim must honour the requested spaceId rather than always
// returning the primary account space, and must deny a space the caller cannot read.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/WorkspaceOpen switch",
	() => {
		const userId = "command-spaceswitch.owner";
		const outsiderId = "command-spaceswitch.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: userId,
						name: "Switch owner",
						email: "command-spaceswitch@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Switch outsider",
						email: "command-spaceswitch-outsider@vanlife.test",
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

		it("opens the requested space, not the primary account space", async () => {
			signInAs(userId);

			const { account } = await (
				await post("/api/command/AccountSelect", {})
			).json();
			const primarySpaceId = account.info.accountSpaceId as string;

			const { spaceId: newSpaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Second Space" },
					useCase: 2,
				})
			).json();
			expect(newSpaceId).not.toBe(primarySpaceId);

			const opened = await (
				await post("/api/command/WorkspaceOpen", { spaceId: newSpaceId })
			).json();

			expect(opened.error).toEqual({ code: 0, description: "" });
			expect(opened.info.accountSpaceId).toBe(newSpaceId);
			expect(opened.info.spaceViewId).not.toBe(account.info.spaceViewId);

			const spaceView = await prisma.obj.findUnique({
				where: { id: opened.info.spaceViewId },
			});
			expect(spaceView?.spaceId).toBe(newSpaceId);
		});

		it("denies opening a space the caller is not a member of", async () => {
			signInAs(userId);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Members Only" },
					useCase: 2,
				})
			).json();

			signInAs(outsiderId);
			const opened = await (
				await post("/api/command/WorkspaceOpen", { spaceId })
			).json();

			expect(opened.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
			expect(opened.info).toBeUndefined();
		});
	},
);
