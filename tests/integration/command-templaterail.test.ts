import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

const TEMPLATE_TYPE_KEY = "ot-template";

// The type-config template rail (sidebar/section/type/template.tsx) and the dataview template
// selector (menu/dataview/template/list.tsx) both subscribe with subId `template-<typeId>` (the
// rail) or an object-id composite (the selector) and the SAME two filters: `type.uniqueKey Equal
// ot-template` and `targetObjectType In <typeId>`. `template` was denylisted as an empty sub, so
// the rail always came back empty; and `targetObjectType` is an object relation stored in the
// details JSONB, which translateSetFilters drops. Together they must list exactly one type's
// templates — never another type's, and nothing at all before any template exists.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectSearchSubscribe template rail",
	() => {
		const owner = "tpl-rail.owner";
		const outsider = "tpl-rail.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Rail owner",
						email: "tpl-rail-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Rail outsider",
						email: "tpl-rail-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({
				where: { id: { in: [owner, outsider] } },
			});
		});

		const provisionSpace = async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Rail space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		const createType = async (spaceId: string, name: string) => {
			signInAs(owner);
			const created = await (
				await post("/api/command/ObjectCreateObjectType", {
					spaceId,
					details: { name },
					internalFlags: [],
				})
			).json();
			return {
				typeId: created.objectId as string,
				uniqueKey: created.details.uniqueKey as string,
			};
		};

		const createTypedObject = async (
			spaceId: string,
			name: string,
			typeUniqueKey: string,
		) => {
			signInAs(owner);
			const { objectId } = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name },
				})
			).json();
			await post("/api/command/ObjectSetObjectType", {
				contextId: objectId,
				objectTypeUniqueKey: typeUniqueKey,
			});
			return objectId as string;
		};

		const createTemplateFrom = async (contextId: string) => {
			signInAs(owner);
			const { id } = await (
				await post("/api/command/TemplateCreateFromObject", { contextId })
			).json();
			return id as string;
		};

		// The rail's wire body: base visibility filters (client getBaseFilters) plus the two
		// template filters, sorted by name. `targetObjectType In` carries a scalar type id and
		// format 100 (object relation), exactly as Mapper.To.Filter emits it.
		const subscribeRail = async (spaceId: string, typeId: string) => {
			signInAs(owner);
			const filters = [
				{
					RelationKey: "isDeleted",
					condition: 2,
					value: true,
					format: 6,
				},
				{
					RelationKey: "isArchived",
					condition: 2,
					value: true,
					format: 6,
				},
				{
					RelationKey: "isHidden",
					condition: 2,
					value: true,
					format: 6,
				},
				{
					RelationKey: "type.uniqueKey",
					condition: 1,
					value: TEMPLATE_TYPE_KEY,
					format: 100,
				},
				{
					RelationKey: "targetObjectType",
					condition: 9,
					value: typeId,
					format: 100,
				},
			];
			return (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `template-${typeId}`,
					filters,
					sorts: [{ RelationKey: "name", type: 0 }],
					keys: ["id", "name", "type", "targetObjectType"],
					source: [],
					limit: 0,
					offset: 0,
					noDepSubscription: true,
					collectionId: "",
				})
			).json();
		};

		it("lists a type's templates and excludes another type's", async () => {
			const spaceId = await provisionSpace();
			const recipe = await createType(spaceId, "Recipe");
			const note = await createType(spaceId, "Note");

			const soup = await createTypedObject(spaceId, "Soup", recipe.uniqueKey);
			const recipeTemplate = await createTemplateFrom(soup);

			const idea = await createTypedObject(spaceId, "Idea", note.uniqueKey);
			const noteTemplate = await createTemplateFrom(idea);

			const recipeRail = await subscribeRail(spaceId, recipe.typeId);
			expect(recipeRail.error).toEqual({ code: 0, description: "" });
			const recipeIds = recipeRail.records.map((it: any) => it.id);
			expect(recipeIds).toContain(recipeTemplate);
			expect(recipeIds).not.toContain(noteTemplate);

			const listed = recipeRail.records.find(
				(it: any) => it.id === recipeTemplate,
			);
			expect(listed.name).toBe("Soup");
			expect(listed.targetObjectType).toEqual([recipe.typeId]);

			const noteRail = await subscribeRail(spaceId, note.typeId);
			const noteIds = noteRail.records.map((it: any) => it.id);
			expect(noteIds).toContain(noteTemplate);
			expect(noteIds).not.toContain(recipeTemplate);
		});

		it("is empty before any template exists", async () => {
			const spaceId = await provisionSpace();
			const recipe = await createType(spaceId, "Recipe");
			await createTypedObject(spaceId, "Soup", recipe.uniqueKey);

			const rail = await subscribeRail(spaceId, recipe.typeId);
			expect(rail.error).toEqual({ code: 0, description: "" });
			expect(rail.records).toEqual([]);
		});

		it("forbids a non-member from reading the rail", async () => {
			const spaceId = await provisionSpace();
			const recipe = await createType(spaceId, "Recipe");

			signInAs(outsider);
			const rail = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `template-${recipe.typeId}`,
					filters: [
						{
							RelationKey: "type.uniqueKey",
							condition: 1,
							value: TEMPLATE_TYPE_KEY,
							format: 100,
						},
						{
							RelationKey: "targetObjectType",
							condition: 9,
							value: recipe.typeId,
							format: 100,
						},
					],
					sorts: [],
					keys: ["id"],
					source: [],
					limit: 0,
					offset: 0,
					noDepSubscription: true,
					collectionId: "",
				})
			).json();
			expect(rail.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
