import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// P2-e: the vault's trash, archive and "recently edited" lists are per-space
// subscriptions (subscription.ts createSpace: deleted/archived/recentEditMe/
// recentEditAll). They only mean something if the write commands that fill them
// (ObjectListDelete, ObjectListSetIsArchived) are real too, so each slice drives a
// mutation through the shim and reads it back through the subscription.
describe.skipIf(!databaseAvailable)("POST /api/command trash + recent", () => {
	const ownerId = "command-trash.owner";
	const otherId = "command-trash.other";
	const outsiderId = "command-trash.outsider";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: ownerId,
					name: "Trash owner",
					email: "command-trash-owner@vanlife.test",
				},
				{
					id: otherId,
					name: "Trash other",
					email: "command-trash-other@vanlife.test",
				},
				{
					id: outsiderId,
					name: "Trash outsider",
					email: "command-trash-outsider@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: ownerId } });
		await prisma.user.deleteMany({
			where: { id: { in: [ownerId, otherId, outsiderId] } },
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

	const createObject = async (spaceId: string, name: string) => {
		signInAs(ownerId);
		const { objectId } = await (
			await post("/api/command/ObjectCreate", {
				spaceId,
				details: { name },
			})
		).json();
		return objectId as string;
	};

	const subscribe = async (subId: string, spaceId: string) => {
		const body = await (
			await post("/api/command/ObjectSearchSubscribe", {
				subId,
				spaceId,
				filters: [],
				sorts: [],
				keys: [],
			})
		).json();
		return body as { records: { id: string }[] };
	};

	it("soft-deletes an object and lists it in the deleted subscription", async () => {
		const spaceId = await createSpace("Trash deleted");
		const objectId = await createObject(spaceId, "Doomed page");

		signInAs(ownerId);
		const deleted = await (
			await post("/api/command/ObjectListDelete", { objectIds: [objectId] })
		).json();
		expect(deleted.error).toEqual({ code: 0, description: "" });

		expect(
			(await prisma.obj.findUnique({ where: { id: objectId } }))?.isDeleted,
		).toBe(true);

		const sub = await subscribe(`deleted-${spaceId}`, spaceId);
		expect(sub.records.map((it) => it.id)).toContain(objectId);
	});

	it("archives an object and lists it in the archived subscription, not the deleted one", async () => {
		const spaceId = await createSpace("Trash archived");
		const objectId = await createObject(spaceId, "Archived page");

		signInAs(ownerId);
		const archived = await (
			await post("/api/command/ObjectListSetIsArchived", {
				objectIds: [objectId],
				isArchived: true,
			})
		).json();
		expect(archived.error).toEqual({ code: 0, description: "" });

		const row = await prisma.obj.findUnique({ where: { id: objectId } });
		expect(row?.isArchived).toBe(true);
		expect(row?.isDeleted).toBe(false);

		const archivedSub = await subscribe(`archived-${spaceId}`, spaceId);
		expect(archivedSub.records.map((it) => it.id)).toContain(objectId);

		const deletedSub = await subscribe(`deleted-${spaceId}`, spaceId);
		expect(deletedSub.records.map((it) => it.id)).not.toContain(objectId);
	});

	it("lists recently edited objects, excluding hidden system objects", async () => {
		const spaceId = await createSpace("Trash recent");
		const first = await createObject(spaceId, "First page");
		const second = await createObject(spaceId, "Second page");

		const sub = await subscribe(`recentEditAll-${spaceId}`, spaceId);
		const ids = sub.records.map((it) => it.id);
		expect(ids).toContain(first);
		expect(ids).toContain(second);

		// The three hidden system objects (profile / spaceView / widgets) must not leak
		// into the recent list.
		const systemRows = await prisma.obj.findMany({
			where: { spaceId, isHidden: true },
			select: { id: true },
		});
		expect(systemRows.length).toBeGreaterThan(0);
		for (const sys of systemRows) {
			expect(ids).not.toContain(sys.id);
		}
	});

	it("scopes recentEditMe to objects the caller created", async () => {
		const spaceId = await createSpace("Trash recent me");
		const mine = await createObject(spaceId, "My page");

		// Another member authors an object in the same space.
		await prisma.spaceMember.create({
			data: {
				spaceId,
				userId: otherId,
				permission: "writer",
				status: "active",
			},
		});
		signInAs(otherId);
		const theirs = await (
			await post("/api/command/ObjectCreate", {
				spaceId,
				details: { name: "Their page" },
			})
		).json();

		signInAs(ownerId);
		const sub = await subscribe(`recentEditMe-${spaceId}`, spaceId);
		const ids = sub.records.map((it) => it.id);
		expect(ids).toContain(mine);
		expect(ids).not.toContain(theirs.objectId);
	});

	it("denies deleting an object in a space the caller cannot write", async () => {
		const spaceId = await createSpace("Trash guarded");
		const objectId = await createObject(spaceId, "Guarded page");

		signInAs(outsiderId);
		const res = await post("/api/command/ObjectListDelete", {
			objectIds: [objectId],
		});
		const body = await res.json();
		expect(body.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});

		expect(
			(await prisma.obj.findUnique({ where: { id: objectId } }))?.isDeleted,
		).toBe(false);
	});
});
