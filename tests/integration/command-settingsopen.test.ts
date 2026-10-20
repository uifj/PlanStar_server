import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// Settings → Types and Settings → Relations reuse the object library pages
// (component/page/main/set.tsx, relation.tsx). Mounted bare from the settings
// menu the route object IS the page id ("set" / "relation") — a synthetic object
// with no Obj row — and each page opens it with C.ObjectOpen on mount. Without
// a view the client raises the object-open error dialog
// (U.Common.checkErrorOnOpen, util/common.ts:552) even though the library
// itself loads through its own subscriptions.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectOpen for a settings library screen",
	() => {
		const userId = "settingsopen.owner";

		let spaceId = "";

		beforeAll(async () => {
			const stale = await prisma.space.findMany({
				where: { createdBy: userId },
				select: { id: true },
			});
			const staleIds = stale.map((it) => it.id);
			await prisma.obj.deleteMany({ where: { spaceId: { in: staleIds } } });
			await prisma.spaceMember.deleteMany({ where: { userId } });
			await prisma.space.deleteMany({ where: { createdBy: userId } });
			await prisma.user.deleteMany({ where: { id: userId } });
			await prisma.user.create({
				data: {
					id: userId,
					name: "Settings open owner",
					email: "settings-open-owner@vanlife.test",
				},
			});

			signInAs(userId);
			spaceId = (
				await (
					await post("/api/command/WorkspaceCreate", {
						details: { name: "Settings screens space" },
						useCase: 2,
					})
				).json()
			).spaceId as string;
		});

		const open = async (objectId: string) => {
			signInAs(userId);
			return (
				await post("/api/command/ObjectOpen", { spaceId, objectId })
			).json();
		};

		it.each(["set", "relation"])(
			"answers %s with a synthetic view instead of NOT_FOUND",
			async (id) => {
				const body = await open(id);

				expect(body.error).toEqual({ code: 0, description: "" });
				expect(body.objectView.rootId).toBe(id);
				const detail = body.objectView.details.find((it: any) => it.id === id);
				expect(detail.details.id).toBe(id);
				expect(detail.details.space).toBe(spaceId);
			},
		);

		it("still answers NOT_FOUND for a missing real object", async () => {
			const body = await open("cm0000000000000000000000000");
			expect(body.error.code).toBe(3);
			expect(body.objectView).toBeUndefined();
		});
	},
);
