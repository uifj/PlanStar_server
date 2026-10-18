import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ObjectRelationDelete is the inverse of ObjectRelationAdd: the sidebar's "remove" action
// (relation.tsx:105) and util/object.ts:1113 (clearing 'layout'/'layoutAlign') lift relation keys
// off an object. The object's local-relation list is derived from the keys on its projected record
// (record.ts:680 -> S.Detail.getKeys), which spreads the details JSONB, so a faithful delete must
// remove the key from details — after which a re-read no longer projects it. A bare OK that leaves
// the key in place would be a fake success. Deleting an absent key is a harmless no-op; an unknown
// object is NOT_FOUND and a non-member FORBIDDEN.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectRelationDelete",
	() => {
		const ownerId = "rel-del.owner";
		const outsiderId = "rel-del.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Relation owner",
						email: "rel-del-owner@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Relation outsider",
						email: "rel-del-outsider@vanlife.test",
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
					details: { name: "Relation space" },
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

		const createRelation = async (spaceId: string, name: string) => {
			signInAs(ownerId);
			const created = await (
				await post("/api/command/ObjectCreateRelation", {
					spaceId,
					details: { name, relationFormat: 1 },
				})
			).json();
			return created.key as string;
		};

		const subscribeRecord = async (spaceId: string, objectId: string) => {
			signInAs(ownerId);
			const res = await (
				await post("/api/command/ObjectSubscribeIds", {
					spaceId,
					subId: `rel-del-${objectId}`,
					ids: [objectId],
					keys: [],
				})
			).json();
			return res.records.find((it: any) => it.id === objectId);
		};

		it("removes a relation key so a later read no longer projects it", async () => {
			const spaceId = await createSpace();
			const key = await createRelation(spaceId, "Author");
			const objectId = await createObject(spaceId, "Post");

			// Hang the relation on first, then take it back off.
			signInAs(ownerId);
			await post("/api/command/ObjectRelationAdd", {
				contextId: objectId,
				relationKeys: [key],
			});
			const before = await subscribeRecord(spaceId, objectId);
			expect(Object.hasOwn(before, key)).toBe(true);

			const body = await (
				await post("/api/command/ObjectRelationDelete", {
					contextId: objectId,
					relationKeys: [key],
				})
			).json();
			expect(body.error).toEqual({ code: 0, description: "" });

			const after = await subscribeRecord(spaceId, objectId);
			expect(Object.hasOwn(after, key)).toBe(false);
		});

		it("deletes one custom key and leaves the others and the name intact", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Priced");

			signInAs(ownerId);
			await post("/api/command/ObjectListSetDetails", {
				objectIds: [objectId],
				details: [{ id: objectId, details: { price: 1200, status: "ok" } }],
			});

			const body = await (
				await post("/api/command/ObjectRelationDelete", {
					contextId: objectId,
					relationKeys: ["price"],
				})
			).json();
			expect(body.error).toEqual({ code: 0, description: "" });

			const record = await subscribeRecord(spaceId, objectId);
			expect(Object.hasOwn(record, "price")).toBe(false);
			expect(record.status).toBe("ok");
			expect(record.name).toBe("Priced");
		});

		it("is a harmless no-op for a key the object does not carry", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Untouched");

			signInAs(ownerId);
			const body = await (
				await post("/api/command/ObjectRelationDelete", {
					contextId: objectId,
					relationKeys: ["not-here"],
				})
			).json();
			expect(body.error).toEqual({ code: 0, description: "" });

			const record = await subscribeRecord(spaceId, objectId);
			expect(record.name).toBe("Untouched");
		});

		it("answers NOT_FOUND for an unknown object", async () => {
			await createSpace();

			signInAs(ownerId);
			const body = await (
				await post("/api/command/ObjectRelationDelete", {
					contextId: "missing-object",
					relationKeys: ["anything"],
				})
			).json();

			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("forbids a non-member from removing a relation", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Guarded");

			signInAs(outsiderId);
			const body = await (
				await post("/api/command/ObjectRelationDelete", {
					contextId: objectId,
					relationKeys: ["name"],
				})
			).json();

			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
