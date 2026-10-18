import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ObjectListDuplicate is the 'pageCopy' action (menu/object.tsx:447): the client sends
// { objectIds }, reads response.ids, and opens ids[0] as the fresh copy. A duplicate is a
// new Obj row copying the source's content (name, details JSONB so custom relation values
// and setOf/object references survive) plus its Yjs body (DocumentState, ADR-0018) and its
// outbound Link rows (ADR-0002 collection membership) — but not inbound links, and with the
// is{Archived,Deleted,Hidden,Favorite} flags reset to their fresh defaults.
describe.skipIf(!databaseAvailable)(
	"POST /api/command ObjectListDuplicate",
	() => {
		const ownerId = "obj-dup.owner";
		const outsiderId = "obj-dup.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Duplicate owner",
						email: "obj-dup-owner@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Duplicate outsider",
						email: "obj-dup-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: ownerId } });
			await prisma.user.deleteMany({
				where: { id: { in: [ownerId, outsiderId] } },
			});
		});

		const createSpace = async () => {
			signInAs(ownerId);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Duplicate space" },
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

		const setDetails = async (
			objectIds: string[],
			details: { id: string; details: Record<string, unknown> }[],
		) => {
			signInAs(ownerId);
			await post("/api/command/ObjectListSetDetails", { objectIds, details });
		};

		const duplicate = async (objectIds: string[]) => {
			signInAs(ownerId);
			return (
				await post("/api/command/ObjectListDuplicate", { objectIds })
			).json();
		};

		// ObjectSubscribeIds hydrates known ids into projected records (details JSONB spread
		// first, then system fields), so a copy's name and custom relation values read back.
		const subscribeIds = async (spaceId: string, ids: string[]) => {
			signInAs(ownerId);
			return (
				await post("/api/command/ObjectSubscribeIds", { spaceId, ids })
			).json();
		};

		it("duplicates an object, copying its name and custom relation values", async () => {
			const spaceId = await createSpace();
			const source = await createObject(spaceId, "Original");
			await setDetails([source], [{ id: source, details: { price: 1200 } }]);

			const body = await duplicate([source]);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.ids).toHaveLength(1);

			const copyId = body.ids[0] as string;
			expect(copyId).not.toBe(source);

			const records = await subscribeIds(spaceId, [copyId]);
			const copy = records.records.find((it: any) => it.id === copyId);
			expect(copy?.name).toBe("Original");
			expect(copy?.price).toBe(1200);
		});

		it("copies the source's Yjs body onto the duplicate", async () => {
			const spaceId = await createSpace();
			const source = await createObject(spaceId, "With body");

			// The body is a folded Yjs document (ADR-0018); no collab server runs here, so the
			// fixture seeds the DocumentState row directly (as the graph test seeds Link rows).
			const state = Buffer.from([1, 2, 3, 4, 5]);
			await prisma.documentState.create({
				data: { objectId: source, state },
			});

			const body = await duplicate([source]);
			const copyId = body.ids[0] as string;

			const copied = await prisma.documentState.findUnique({
				where: { objectId: copyId },
			});
			expect(copied).not.toBeNull();
			expect(Buffer.from(copied?.state ?? []).equals(state)).toBe(true);
		});

		it("copies the source's outbound collection links onto the duplicate", async () => {
			const spaceId = await createSpace();
			const source = await createObject(spaceId, "Collection");
			const member = await createObject(spaceId, "Member");

			// Collection membership is an outbound Link edge (ADR-0002); seed it directly.
			await prisma.link.create({
				data: {
					spaceId,
					fromId: source,
					toId: member,
					relationKey: "collection",
					sortOrder: "0001",
				},
			});

			const body = await duplicate([source]);
			const copyId = body.ids[0] as string;

			const copyLinks = await prisma.link.findMany({
				where: { fromId: copyId },
			});
			expect(copyLinks).toHaveLength(1);
			expect(copyLinks[0]).toMatchObject({
				toId: member,
				relationKey: "collection",
				sortOrder: "0001",
			});

			// The source keeps its own edge — a duplicate copies, it does not move.
			const sourceLinks = await prisma.link.findMany({
				where: { fromId: source },
			});
			expect(sourceLinks).toHaveLength(1);
		});

		it("duplicates several objects, keeping the ids in request order", async () => {
			const spaceId = await createSpace();
			const first = await createObject(spaceId, "First");
			const second = await createObject(spaceId, "Second");

			const body = await duplicate([first, second]);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.ids).toHaveLength(2);

			const records = await subscribeIds(spaceId, body.ids as string[]);
			const nameOf = (id: string) =>
				records.records.find((it: any) => it.id === id)?.name;
			expect(nameOf(body.ids[0])).toBe("First");
			expect(nameOf(body.ids[1])).toBe("Second");
		});

		it("denies a caller who cannot write the space", async () => {
			const spaceId = await createSpace();
			const source = await createObject(spaceId, "Guarded");

			signInAs(outsiderId);
			const res = await (
				await post("/api/command/ObjectListDuplicate", {
					objectIds: [source],
				})
			).json();
			expect(res.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});

		it("answers NOT_FOUND when no listed object exists", async () => {
			await createSpace();
			const body = await duplicate(["missing-object"]);
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});
	},
);
