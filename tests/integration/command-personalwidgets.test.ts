import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// On every space switch the client opens its personal widgets object
// (U.Data.onSpaceSwitch -> C.ObjectOpen(U.Object.getPersonalWidgetsId(space))), whose id is
// derived from the space id (`_personalWidgets_<spaceId>`, J.Constant.widgetId). No Obj row
// is ever written for that synthetic id, so the kernel answered NOT_FOUND and the browser
// logged "Error ObjectOpen code: 3" on every boot. The command has to answer the view.
describe.skipIf(!databaseAvailable)(
	"ObjectOpen of the synthetic personal widgets object",
	() => {
		const owner = "pw.owner";
		const intruder = "pw.intruder";

		let spaceId = "";
		let personalWidgetsId = "";

		beforeAll(async () => {
			await prisma.space.deleteMany({
				where: { createdBy: { in: [owner, intruder] } },
			});
			await prisma.user.deleteMany({
				where: { id: { in: [owner, intruder] } },
			});
			await prisma.user.createMany({
				data: [
					{ id: owner, name: "Widgets owner", email: "pw-owner@vanlife.test" },
					{
						id: intruder,
						name: "Widgets intruder",
						email: "pw-intruder@vanlife.test",
					},
				],
			});

			signInAs(owner);
			const created = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Widgets space" },
					useCase: 2,
				})
			).json();
			spaceId = created.spaceId as string;
			// Exactly how the client derives it (util/object.ts:28).
			personalWidgetsId = `_personalWidgets_${spaceId.replace(/\./g, "_")}`;
		});

		it("answers the personal widgets view for a space member", async () => {
			signInAs(owner);
			const body = await (
				await post("/api/command/ObjectOpen", {
					objectId: personalWidgetsId,
					spaceId,
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.objectView.rootId).toBe(personalWidgetsId);
			expect(
				body.objectView.details.some(
					(entry: any) => entry.id === personalWidgetsId,
				),
			).toBe(true);
		});

		it("refers to the space named by the id when the request carries no spaceId", async () => {
			signInAs(owner);
			const body = await (
				await post("/api/command/ObjectOpen", {
					objectId: personalWidgetsId,
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.objectView.rootId).toBe(personalWidgetsId);
		});

		it("refuses a caller who is not a member of that space", async () => {
			signInAs(intruder);
			const body = await (
				await post("/api/command/ObjectOpen", {
					objectId: personalWidgetsId,
					spaceId,
				})
			).json();

			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
