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

// TemplateCreateFromObject is the 'templateCreate' action (menu/object.tsx:526): the client
// sends { contextId } and reads response.id (response.ts:609) to open the fresh template. A
// template is an Obj typed ot-template whose details.targetObjectType points back at the
// source's type, so the type's template rail (sidebar/section/type/template.tsx) lists it. It
// copies the source's content details and its Yjs body (DocumentState, ADR-0018). The
// ot-template ObjectType is ensured lazily — a fresh space seeds no default types, so the first
// template mints it rather than failing.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/TemplateCreateFromObject",
	() => {
		const owner = "tpl-create.owner";
		const outsider = "tpl-create.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Template owner",
						email: "tpl-create-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Template outsider",
						email: "tpl-create-outsider@vanlife.test",
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
					details: { name: "Template space" },
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

		const createObject = async (spaceId: string, name: string) => {
			signInAs(owner);
			const { objectId } = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name },
				})
			).json();
			return objectId as string;
		};

		const setObjectType = async (
			contextId: string,
			objectTypeUniqueKey: string,
		) => {
			signInAs(owner);
			await post("/api/command/ObjectSetObjectType", {
				contextId,
				objectTypeUniqueKey,
			});
		};

		const createTemplate = async (contextId: string) => {
			signInAs(owner);
			return (
				await post("/api/command/TemplateCreateFromObject", { contextId })
			).json();
		};

		const subscribeIds = async (spaceId: string, ids: string[]) => {
			signInAs(owner);
			return (
				await post("/api/command/ObjectSubscribeIds", {
					spaceId,
					ids,
					keys: [],
				})
			).json();
		};

		it("creates an ot-template object pointing back at the source's type", async () => {
			const spaceId = await provisionSpace();
			const { typeId, uniqueKey } = await createType(spaceId, "Recipe");
			const source = await createObject(spaceId, "Soup");
			await setObjectType(source, uniqueKey);

			const body = await createTemplate(source);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(typeof body.id).toBe("string");
			expect(body.id).not.toBe(source);

			const templateId = body.id as string;

			// The ot-template type is ensured lazily on first use.
			const templateType = await prisma.objectType.findUnique({
				where: {
					spaceId_uniqueKey: { spaceId, uniqueKey: TEMPLATE_TYPE_KEY },
				},
			});
			expect(templateType).not.toBeNull();

			const records = await subscribeIds(spaceId, [templateId]);
			const record = records.records.find((it: any) => it.id === templateId);
			expect(record).toBeDefined();
			expect(record.type).toEqual([templateType?.id]);
			expect(record.targetObjectType).toEqual([typeId]);
			expect(record.name).toBe("Soup");
		});

		it("copies the source's Yjs body onto the template", async () => {
			const spaceId = await provisionSpace();
			const source = await createObject(spaceId, "With body");

			// The body is a folded Yjs document (ADR-0018); no collab server runs here, so the
			// fixture seeds the DocumentState row directly (as the duplicate test does).
			const state = Buffer.from([9, 8, 7, 6]);
			await prisma.documentState.create({
				data: { objectId: source, state },
			});

			const body = await createTemplate(source);
			const templateId = body.id as string;

			const copied = await prisma.documentState.findUnique({
				where: { objectId: templateId },
			});
			expect(copied).not.toBeNull();
			expect(Buffer.from(copied?.state ?? []).equals(state)).toBe(true);
		});

		it("answers NOT_FOUND for an unknown source object", async () => {
			await provisionSpace();
			const body = await createTemplate("missing-object");
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("forbids a non-member from templating an object", async () => {
			const spaceId = await provisionSpace();
			const source = await createObject(spaceId, "Guarded");

			signInAs(outsider);
			const body = await (
				await post("/api/command/TemplateCreateFromObject", {
					contextId: source,
				})
			).json();
			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
