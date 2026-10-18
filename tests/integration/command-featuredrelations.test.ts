import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// action.ts:1295 toggleFeatureRelation reads the object's `featuredRelations` detail and calls
// ObjectRelationAddFeatured / ObjectRelationRemoveFeatured with { contextId, relations: [key] } to
// move a relation into or out of the featured block under the title. The featured block renders
// whatever keys are on that array, so a faithful shim must persist the toggle onto the object's
// details.featuredRelations and read it back verbatim. A bare OK that stores nothing would leave the
// star unchanged — a fake success. Add must dedupe and preserve order; an unknown object is
// NOT_FOUND and a non-member FORBIDDEN.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectRelationAddFeatured + RemoveFeatured",
	() => {
		const ownerId = "feat-rel.owner";
		const outsiderId = "feat-rel.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Featured owner",
						email: "feat-rel-owner@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Featured outsider",
						email: "feat-rel-outsider@vanlife.test",
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
					details: { name: "Featured space" },
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
					subId: `feat-rel-${objectId}`,
					ids: [objectId],
					keys: [],
				})
			).json();
			return res.records.find((it: any) => it.id === objectId);
		};

		it("features a relation so a later read projects it in featuredRelations", async () => {
			const spaceId = await createSpace();
			const key = await createRelation(spaceId, "Author");
			const objectId = await createObject(spaceId, "Post");

			signInAs(ownerId);
			const body = await (
				await post("/api/command/ObjectRelationAddFeatured", {
					contextId: objectId,
					relations: [key],
				})
			).json();
			expect(body.error).toEqual({ code: 0, description: "" });

			const record = await subscribeRecord(spaceId, objectId);
			expect(record.featuredRelations).toEqual([key]);
		});

		it("unfeatures a relation, dropping it from featuredRelations", async () => {
			const spaceId = await createSpace();
			const key = await createRelation(spaceId, "Status");
			const objectId = await createObject(spaceId, "Tracked");

			signInAs(ownerId);
			await post("/api/command/ObjectRelationAddFeatured", {
				contextId: objectId,
				relations: [key],
			});

			const body = await (
				await post("/api/command/ObjectRelationRemoveFeatured", {
					contextId: objectId,
					relations: [key],
				})
			).json();
			expect(body.error).toEqual({ code: 0, description: "" });

			const record = await subscribeRecord(spaceId, objectId);
			expect(record.featuredRelations).toEqual([]);
		});

		it("dedupes and preserves order across repeated adds", async () => {
			const spaceId = await createSpace();
			const keyA = await createRelation(spaceId, "First");
			const keyB = await createRelation(spaceId, "Second");
			const objectId = await createObject(spaceId, "Ordered");

			signInAs(ownerId);
			await post("/api/command/ObjectRelationAddFeatured", {
				contextId: objectId,
				relations: [keyA],
			});
			// Re-adding keyA alongside keyB must not duplicate keyA and must keep insertion order.
			await post("/api/command/ObjectRelationAddFeatured", {
				contextId: objectId,
				relations: [keyB, keyA],
			});

			const record = await subscribeRecord(spaceId, objectId);
			expect(record.featuredRelations).toEqual([keyA, keyB]);
		});

		it("answers NOT_FOUND for an unknown object", async () => {
			await createSpace();

			signInAs(ownerId);
			const body = await (
				await post("/api/command/ObjectRelationAddFeatured", {
					contextId: "missing-object",
					relations: ["anything"],
				})
			).json();

			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("forbids a non-member from featuring a relation", async () => {
			const spaceId = await createSpace();
			const key = await createRelation(spaceId, "Owner only");
			const objectId = await createObject(spaceId, "Guarded");

			signInAs(outsiderId);
			const body = await (
				await post("/api/command/ObjectRelationAddFeatured", {
					contextId: objectId,
					relations: [key],
				})
			).json();

			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
