import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The sidebar's create menu (component/menu/type/suggest.tsx) does not read the `type-<spaceId>`
// registry: it issues a one-shot ObjectSearch carrying the client's own filters — recommendedLayout
// In the creatable layouts, uniqueKey NotIn [template, type] — plus the base isHidden/isDeleted/
// isArchived ones. ObjectSearch only looked at fullText and searched object rows, so an empty filter
// box (exactly what opening the menu sends) returned nothing and the menu read "No Objects found".
// Filters ride the Anytype wire shape: RelationKey + numeric condition (In === 9, NotIn === 10).
const TYPE_PICKER_FILTERS = [
	{
		RelationKey: "recommendedLayout",
		format: 2,
		condition: 9,
		value: [0, 1, 2, 3, 4, 5, 6, 7, 11, 12, 18, 19, 20, 21],
	},
	{
		RelationKey: "uniqueKey",
		format: 5,
		condition: 10,
		value: ["ot-template", "ot-type"],
	},
	{ RelationKey: "isHidden", format: 6, condition: 2, value: true },
	{ RelationKey: "isDeleted", format: 6, condition: 2, value: true },
	{ RelationKey: "isArchived", format: 6, condition: 2, value: true },
];

describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectSearch for the type picker",
	() => {
		const userId = "command-typepicker.owner";

		let spaceId = "";

		beforeAll(async () => {
			const stale = await prisma.space.findMany({
				where: { createdBy: userId },
				select: { id: true },
			});
			const staleIds = stale.map((it) => it.id);
			await prisma.obj.deleteMany({ where: { spaceId: { in: staleIds } } });
			await prisma.objectType.deleteMany({
				where: { spaceId: { in: staleIds } },
			});
			await prisma.spaceMember.deleteMany({ where: { userId } });
			await prisma.space.deleteMany({ where: { createdBy: userId } });
			await prisma.user.deleteMany({ where: { id: userId } });
			await prisma.user.create({
				data: {
					id: userId,
					name: "Type picker owner",
					email: "command-typepicker-owner@vanlife.test",
				},
			});

			signInAs(userId);
			spaceId = (
				await (
					await post("/api/command/WorkspaceCreate", {
						details: { name: "Picker space" },
						useCase: 2,
					})
				).json()
			).spaceId as string;

			await prisma.objectType.create({
				data: { spaceId, uniqueKey: "ot-template", name: "Template" },
			});
			await prisma.objectType.create({
				data: { spaceId, uniqueKey: "ot-meeting", name: "Meeting" },
			});

			await post("/api/command/ObjectCreate", {
				spaceId,
				objectTypeUniqueKey: "ot-page",
				details: { name: "An ordinary page" },
			});
		});

		it("lists the space's types when no text is typed", async () => {
			signInAs(userId);
			const body = await (
				await post("/api/command/ObjectSearch", {
					spaceId,
					filters: TYPE_PICKER_FILTERS,
					sorts: [],
					keys: [],
					fullText: "",
					offset: 0,
					limit: 50,
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });

			const keys = (body.records || []).map((it: any) => it.uniqueKey);
			expect(keys).toContain("ot-page");
			expect(keys).toContain("ot-meeting");
			// uniqueKey NotIn [ot-template, ot-type] still narrows the list.
			expect(keys).not.toContain("ot-template");
		});

		it("narrows the type list by the typed text", async () => {
			signInAs(userId);
			const body = await (
				await post("/api/command/ObjectSearch", {
					spaceId,
					filters: TYPE_PICKER_FILTERS,
					sorts: [],
					keys: [],
					fullText: "meet",
					offset: 0,
					limit: 50,
				})
			).json();

			const keys = (body.records || []).map((it: any) => it.uniqueKey);
			expect(keys).toEqual(["ot-meeting"]);
		});

		it("keeps searching objects for a filter that does not name a type relation", async () => {
			signInAs(userId);
			const body = await (
				await post("/api/command/ObjectSearch", {
					spaceId,
					filters: [
						{ RelationKey: "isHidden", format: 6, condition: 2, value: true },
					],
					sorts: [],
					keys: [],
					fullText: "ordinary",
					offset: 0,
					limit: 50,
				})
			).json();

			const names = (body.records || []).map((it: any) => it.name);
			expect(names).toContain("An ordinary page");
			expect(names).not.toContain("Meeting");
		});
	},
);
