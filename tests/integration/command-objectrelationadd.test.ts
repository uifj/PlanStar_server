import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The relation suggest menu sends ObjectRelationAdd({ contextId, relationKeys }) to hang an
// existing relation off an object (block/relation.tsx:58, sidebar/page/object/relation.tsx:132);
// both callers only branch on error.code, then re-read. The object's "local" relation section is
// derived from S.Detail.getKeys minus the type's keys (record.ts:680), and those keys come off the
// object's projected record — which spreads the details JSONB (registry-service.ts objectRecord).
// So a faithful add must write each key onto the object's details, seeded with a format-appropriate
// empty value, without clobbering a value already there. A bare OK that persists nothing would be a
// fake success: the relation would never appear. An unknown object is NOT_FOUND, a non-member
// FORBIDDEN.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectRelationAdd",
	() => {
		const ownerId = "rel-add.owner";
		const outsiderId = "rel-add.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Relation owner",
						email: "rel-add-owner@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Relation outsider",
						email: "rel-add-outsider@vanlife.test",
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

		// relationFormat is Anytype's numeric I.RelationType: 1 shortText, 2 number, 6 checkbox.
		const createRelation = async (
			spaceId: string,
			name: string,
			relationFormat: number,
		) => {
			signInAs(ownerId);
			const created = await (
				await post("/api/command/ObjectCreateRelation", {
					spaceId,
					details: { name, relationFormat },
				})
			).json();
			return created.key as string;
		};

		const subscribeRecord = async (spaceId: string, objectId: string) => {
			signInAs(ownerId);
			const res = await (
				await post("/api/command/ObjectSubscribeIds", {
					spaceId,
					subId: `rel-add-${objectId}`,
					ids: [objectId],
					keys: [],
				})
			).json();
			return res.records.find((it: any) => it.id === objectId);
		};

		it("hangs a text relation off an object so a later read projects it", async () => {
			const spaceId = await createSpace();
			const key = await createRelation(spaceId, "Author", 1);
			const objectId = await createObject(spaceId, "Post");

			const body = await (
				await post("/api/command/ObjectRelationAdd", {
					contextId: objectId,
					relationKeys: [key],
				})
			).json();
			expect(body.error).toEqual({ code: 0, description: "" });

			const record = await subscribeRecord(spaceId, objectId);
			expect(record).toBeDefined();
			expect(Object.hasOwn(record, key)).toBe(true);
			expect(record[key]).toBe("");
		});

		it("seeds a checkbox relation as false, not an empty string", async () => {
			const spaceId = await createSpace();
			const key = await createRelation(spaceId, "Published", 6);
			const objectId = await createObject(spaceId, "Draft");

			await post("/api/command/ObjectRelationAdd", {
				contextId: objectId,
				relationKeys: [key],
			});

			const record = await subscribeRecord(spaceId, objectId);
			expect(record[key]).toBe(false);
		});

		it("preserves a value already set and is idempotent", async () => {
			const spaceId = await createSpace();
			const key = await createRelation(spaceId, "Rating", 2);
			const objectId = await createObject(spaceId, "Scored");

			// Seed a real value through the client's write path, then add the same relation.
			signInAs(ownerId);
			await post("/api/command/ObjectListSetDetails", {
				objectIds: [objectId],
				details: [{ id: objectId, details: { [key]: 5 } }],
			});

			const first = await (
				await post("/api/command/ObjectRelationAdd", {
					contextId: objectId,
					relationKeys: [key],
				})
			).json();
			expect(first.error).toEqual({ code: 0, description: "" });
			const second = await (
				await post("/api/command/ObjectRelationAdd", {
					contextId: objectId,
					relationKeys: [key],
				})
			).json();
			expect(second.error).toEqual({ code: 0, description: "" });

			const record = await subscribeRecord(spaceId, objectId);
			expect(record[key]).toBe(5);
		});

		it("answers NOT_FOUND for an unknown object", async () => {
			const spaceId = await createSpace();
			const key = await createRelation(spaceId, "Tag", 1);

			const body = await (
				await post("/api/command/ObjectRelationAdd", {
					contextId: "missing-object",
					relationKeys: [key],
				})
			).json();

			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("forbids a non-member from adding a relation", async () => {
			const spaceId = await createSpace();
			const key = await createRelation(spaceId, "Owner only", 1);
			const objectId = await createObject(spaceId, "Guarded");

			signInAs(outsiderId);
			const body = await (
				await post("/api/command/ObjectRelationAdd", {
					contextId: objectId,
					relationKeys: [key],
				})
			).json();

			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
