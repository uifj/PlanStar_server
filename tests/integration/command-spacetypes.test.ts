import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The shell lists the space's types in its create menu and in the sidebar's Type section,
// both read from the `type-<spaceId>` subscription. A space created through WorkspaceCreate
// carried no types at all, so the menu answered "No Objects found" and there was no way to
// create an object as a type. A fresh space must therefore install the defaults the client
// itself treats as creatable (U.Data.getWidgetTypes: page / task / collection).
describe.skipIf(!databaseAvailable)(
	"a new space installs its default types",
	() => {
		const owner = "spacetypes.owner";

		let spaceId = "";

		beforeAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({ where: { id: owner } });
			await prisma.user.create({
				data: {
					id: owner,
					name: "Types owner",
					email: "spacetypes-owner@vanlife.test",
				},
			});

			signInAs(owner);
			spaceId = (
				await (
					await post("/api/command/WorkspaceCreate", {
						details: { name: "Typed space" },
						useCase: 2,
					})
				).json()
			).spaceId as string;
		});

		it("lists the default types on the type subscription", async () => {
			signInAs(owner);
			const body = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `type-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
					offset: 0,
					limit: 50,
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });

			const keys = (body.records || []).map((it: any) => it.uniqueKey);
			expect(keys).toContain("ot-page");
			expect(keys).toContain("ot-task");
			expect(keys).toContain("ot-collection");
		});

		it("creates an object as one of those types", async () => {
			signInAs(owner);
			const created = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					objectTypeUniqueKey: "ot-page",
					details: { name: "Typed from a default" },
				})
			).json();
			expect(created.error).toEqual({ code: 0, description: "" });

			const typed = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `page-probe-${spaceId}`,
					// Anytype wire filter (Mapper.To.Filter): RelationKey + numeric condition, In === 9.
					filters: [
						{
							RelationKey: "type.uniqueKey",
							format: 5,
							condition: 9,
							value: ["ot-page"],
						},
					],
					sorts: [],
					keys: [],
					offset: 0,
					limit: 20,
				})
			).json();

			const ids = (typed.records || []).map((it: any) => it.id);
			expect(ids).toContain(created.objectId);

			const task = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					objectTypeUniqueKey: "ot-task",
					details: { name: "Not a page" },
				})
			).json();
			expect(task.error).toEqual({ code: 0, description: "" });

			const afterTask = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `page-probe-${spaceId}`,
					filters: [
						{
							RelationKey: "type.uniqueKey",
							format: 5,
							condition: 9,
							value: ["ot-page"],
						},
					],
					sorts: [],
					keys: [],
					offset: 0,
					limit: 20,
				})
			).json();

			// The page filter still narrows to pages: the task object stays out of it.
			expect(afterTask.records.map((it: any) => it.id)).toContain(
				created.objectId,
			);
			expect(afterTask.records.map((it: any) => it.id)).not.toContain(
				task.objectId,
			);
		});
	},
);

// Spaces booted before the defaults existed are already in front of the user, so the boot
// provisioning path has to heal them the same way it re-creates a missing system object.
// A reader cannot write the registry, so healing must never break their WorkspaceOpen.
describe.skipIf(!databaseAvailable)(
	"a space that predates the defaults heals them on boot",
	() => {
		const owner = "spacetypes.legacy";
		const reader = "spacetypes.reader";

		let spaceId = "";

		beforeAll(async () => {
			const stale = await prisma.space.findMany({
				where: { createdBy: owner },
				select: { id: true },
			});
			const staleIds = stale.map((it) => it.id);
			await prisma.obj.deleteMany({ where: { spaceId: { in: staleIds } } });
			await prisma.objectType.deleteMany({
				where: { spaceId: { in: staleIds } },
			});
			await prisma.spaceMember.deleteMany({
				where: { userId: { in: [owner, reader] } },
			});
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({ where: { id: { in: [owner, reader] } } });
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Legacy owner",
						email: "spacetypes-legacy@vanlife.test",
					},
					{
						id: reader,
						name: "Legacy reader",
						email: "spacetypes-reader@vanlife.test",
					},
				],
			});

			const space = await prisma.space.create({
				data: {
					name: "Legacy space",
					createdBy: owner,
					members: {
						create: [
							{ userId: owner, permission: "owner", status: "active" },
							{ userId: reader, permission: "reader", status: "active" },
						],
					},
				},
				select: { id: true },
			});
			spaceId = space.id;
		});

		it("lists the default types once the owner boots into it", async () => {
			signInAs(owner);

			const account = await (
				await post("/api/command/AccountSelect", {})
			).json();
			expect(account.error).toEqual({ code: 0, description: "" });

			const body = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `type-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
					offset: 0,
					limit: 50,
				})
			).json();

			const keys = (body.records || []).map((it: any) => it.uniqueKey);
			expect(keys).toContain("ot-page");
			expect(keys).toContain("ot-task");
			expect(keys).toContain("ot-collection");
		});

		it("still opens the space for a reader who cannot install types", async () => {
			// A space the owner has never booted, so the reader is the only one who can try to
			// heal it — and extending the registry is above their permission.
			const foreign = await prisma.space.create({
				data: {
					name: "Legacy space as a reader",
					createdBy: owner,
					members: {
						create: [
							{ userId: owner, permission: "owner", status: "active" },
							{ userId: reader, permission: "reader", status: "active" },
						],
					},
				},
				select: { id: true },
			});

			signInAs(reader);

			const body = await (
				await post("/api/command/WorkspaceOpen", { spaceId: foreign.id })
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(
				await prisma.objectType.count({ where: { spaceId: foreign.id } }),
			).toBe(0);
		});
	},
);
