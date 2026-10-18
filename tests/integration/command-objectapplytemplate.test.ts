import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ObjectApplyTemplate (banner.tsx:60, featured.tsx:378) replaces an object's content with a
// template's: the client sends { contextId, templateId } and reads nothing back (write-only).
// In this kernel the body is a folded Yjs document (DocumentState, ADR-0018), so applying a
// template overwrites the target's DocumentState with a copy of the template's — while the
// target keeps its own id, name and type (applying a template does not retype or rename).
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectApplyTemplate",
	() => {
		const owner = "tpl-apply.owner";
		const outsider = "tpl-apply.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Apply owner",
						email: "tpl-apply-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Apply outsider",
						email: "tpl-apply-outsider@vanlife.test",
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
					details: { name: "Apply space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
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

		const seedBody = async (objectId: string, bytes: number[]) => {
			await prisma.documentState.upsert({
				where: { objectId },
				create: { objectId, state: Buffer.from(bytes) },
				update: { state: Buffer.from(bytes) },
			});
		};

		const makeTemplate = async (spaceId: string, bytes: number[]) => {
			const source = await createObject(spaceId, "Template source");
			await seedBody(source, bytes);
			signInAs(owner);
			const { id } = await (
				await post("/api/command/TemplateCreateFromObject", {
					contextId: source,
				})
			).json();
			return id as string;
		};

		const applyTemplate = async (contextId: string, templateId: string) => {
			signInAs(owner);
			return (
				await post("/api/command/ObjectApplyTemplate", {
					contextId,
					templateId,
				})
			).json();
		};

		it("overwrites the target's Yjs body with the template's", async () => {
			const spaceId = await provisionSpace();
			const templateId = await makeTemplate(spaceId, [10, 20, 30]);

			const target = await createObject(spaceId, "Target");
			await seedBody(target, [1, 1, 1]);

			const body = await applyTemplate(target, templateId);
			expect(body.error).toEqual({ code: 0, description: "" });

			const applied = await prisma.documentState.findUnique({
				where: { objectId: target },
			});
			expect(applied).not.toBeNull();
			expect(
				Buffer.from(applied?.state ?? []).equals(Buffer.from([10, 20, 30])),
			).toBe(true);
		});

		it("leaves the target's name and type untouched", async () => {
			const spaceId = await provisionSpace();
			const templateId = await makeTemplate(spaceId, [7, 7]);

			const target = await createObject(spaceId, "Keep me");
			const before = await prisma.obj.findUnique({ where: { id: target } });

			const body = await applyTemplate(target, templateId);
			expect(body.error).toEqual({ code: 0, description: "" });

			const after = await prisma.obj.findUnique({ where: { id: target } });
			expect(after?.name).toBe("Keep me");
			// The template is typed ot-template; applying it must not retype the target.
			expect(after?.typeId).toBe(before?.typeId);
		});

		it("answers NOT_FOUND for an unknown target", async () => {
			const spaceId = await provisionSpace();
			const templateId = await makeTemplate(spaceId, [1]);

			const body = await applyTemplate("missing-target", templateId);
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("answers NOT_FOUND for an unknown template", async () => {
			const spaceId = await provisionSpace();
			const target = await createObject(spaceId, "Target");

			const body = await applyTemplate(target, "missing-template");
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("forbids a non-member from applying a template", async () => {
			const spaceId = await provisionSpace();
			const templateId = await makeTemplate(spaceId, [5, 5]);
			const target = await createObject(spaceId, "Guarded");

			signInAs(outsider);
			const body = await (
				await post("/api/command/ObjectApplyTemplate", {
					contextId: target,
					templateId,
				})
			).json();
			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
