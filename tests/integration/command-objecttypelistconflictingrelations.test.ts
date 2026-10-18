import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ObjectTypeListConflictingRelations backs the type sidebar's "found relations" list
// (component/sidebar/section/type/relation.tsx:95): a relation "conflicts" with a type when a live
// object of that type carries a value for it but the type does not install it, so the editor offers
// to add it. The value lives either in the object's details JSONB (the command write path) or as an
// object-format Link row (the Phase-2 write path); installed means Relation.typeId points at the type.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectTypeListConflictingRelations",
	() => {
		const ownerId = "conflict.owner";
		const outsiderId = "conflict.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Conflict owner",
						email: "conflict-owner@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Conflict outsider",
						email: "conflict-outsider@vanlife.test",
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
					details: { name: "Conflict space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		const createType = async (spaceId: string, name: string) => {
			signInAs(ownerId);
			const body = await (
				await post("/api/command/ObjectCreateObjectType", {
					spaceId,
					details: { name },
				})
			).json();
			return {
				id: body.objectId as string,
				uniqueKey: body.details.uniqueKey as string,
			};
		};

		const createRelation = async (
			spaceId: string,
			name: string,
			relationFormat = 1,
		) => {
			signInAs(ownerId);
			const body = await (
				await post("/api/command/ObjectCreateRelation", {
					spaceId,
					details: { name, relationFormat },
				})
			).json();
			return { id: body.objectId as string, key: body.key as string };
		};

		const createObject = async (
			spaceId: string,
			typeUniqueKey: string,
			details: Record<string, unknown>,
		) => {
			signInAs(ownerId);
			const body = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					objectTypeUniqueKey: typeUniqueKey,
					details,
				})
			).json();
			return body.objectId as string;
		};

		const conflicts = async (spaceId: string, typeObjectId: string) => {
			signInAs(ownerId);
			return (
				await post("/api/command/ObjectTypeListConflictingRelations", {
					spaceId,
					typeObjectId,
				})
			).json();
		};

		it("returns a relation the type's objects carry but the type does not install", async () => {
			const spaceId = await createSpace();
			const type = await createType(spaceId, "Trip");
			const relation = await createRelation(spaceId, "Distance");
			await createObject(spaceId, type.uniqueKey, {
				name: "Leg one",
				[relation.key]: "120km",
			});

			const body = await conflicts(spaceId, type.id);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.relationIds).toContain(relation.id);
		});

		it("omits a relation already installed on the type", async () => {
			const spaceId = await createSpace();
			const type = await createType(spaceId, "Trip");
			const relation = await createRelation(spaceId, "Distance");
			await prisma.relation.update({
				where: { id: relation.id },
				data: { typeId: type.id },
			});
			await createObject(spaceId, type.uniqueKey, {
				name: "Leg one",
				[relation.key]: "120km",
			});

			const body = await conflicts(spaceId, type.id);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.relationIds).not.toContain(relation.id);
		});

		it("omits a relation no object of the type carries", async () => {
			const spaceId = await createSpace();
			const type = await createType(spaceId, "Trip");
			const unused = await createRelation(spaceId, "Unused");
			await createObject(spaceId, type.uniqueKey, { name: "Leg one" });

			const body = await conflicts(spaceId, type.id);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.relationIds).not.toContain(unused.id);
		});

		it("returns an object-format relation carried only as a link", async () => {
			const spaceId = await createSpace();
			const type = await createType(spaceId, "Trip");
			const relation = await createRelation(spaceId, "Driver", 100);
			const fromId = await createObject(spaceId, type.uniqueKey, {
				name: "Leg one",
			});
			const toId = await createObject(spaceId, type.uniqueKey, {
				name: "Ada",
			});
			await prisma.link.create({
				data: { spaceId, fromId, toId, relationKey: relation.key },
			});

			const body = await conflicts(spaceId, type.id);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.relationIds).toContain(relation.id);
		});

		it("denies a caller who cannot read the space", async () => {
			const spaceId = await createSpace();
			const type = await createType(spaceId, "Trip");

			signInAs(outsiderId);
			const res = await post(
				"/api/command/ObjectTypeListConflictingRelations",
				{ spaceId, typeObjectId: type.id },
			);
			expect((await res.json()).error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});

		it("answers NOT_FOUND for an empty spaceId", async () => {
			const body = await conflicts("", "any-type");
			expect(body.error).toEqual({
				code: 3,
				description: "Object not found.",
			});
		});

		it("answers NOT_FOUND for a type that is not in the space", async () => {
			const spaceId = await createSpace();
			const body = await conflicts(spaceId, "does-not-exist");
			expect(body.error).toEqual({
				code: 3,
				description: "Object not found.",
			});
		});
	},
);
