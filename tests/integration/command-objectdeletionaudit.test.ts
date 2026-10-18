import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ObjectDeletionAudit backs the space settings "Deletion audit" page
// (settings/space/deletionAudit.tsx): the client sends { spaceId, keys, offset, limit } and
// reads { records, total } (response.ts:308). It lists what was removed from the space, newest
// first. A deleted object row carries id, deletedBy, deletedDate and isUninstalled:false
// regardless of the keys requested (the mapper is a bare Decode.struct, so nothing is
// fabricated). Deletion in this backend is a soft delete (Obj.isDeleted), so the audit reads
// the trashed rows and stamps deletedDate/deletedBy when ObjectListDelete lands.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectDeletionAudit",
	() => {
		const owner = "del-audit.owner";
		const outsider = "del-audit.outsider";

		const KEYS = [
			"name",
			"creator",
			"createdDate",
			"type",
			"resolvedLayout",
			"layout",
		];

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Audit owner",
						email: "del-audit-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Audit outsider",
						email: "del-audit-outsider@vanlife.test",
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
					details: { name: "Audit space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		const createObject = async (spaceId: string, name: string) => {
			signInAs(owner);
			const { objectId } = await (
				await post("/api/command/ObjectCreate", { spaceId, details: { name } })
			).json();
			return objectId as string;
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
			objectTypeUniqueKey: string,
		) => {
			signInAs(owner);
			const { objectId } = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name },
					objectTypeUniqueKey,
				})
			).json();
			return objectId as string;
		};

		const deleteObjects = async (objectIds: string[]) => {
			signInAs(owner);
			return (
				await post("/api/command/ObjectListDelete", { objectIds })
			).json();
		};

		const audit = async (
			spaceId: string,
			offset = 0,
			limit = 100,
			as = owner,
		) => {
			signInAs(as);
			return (
				await post("/api/command/ObjectDeletionAudit", {
					spaceId,
					keys: KEYS,
					offset,
					limit,
				})
			).json();
		};

		it("lists the objects deleted from the space with a total count", async () => {
			const spaceId = await provisionSpace();
			const first = await createObject(spaceId, "First");
			const second = await createObject(spaceId, "Second");

			await deleteObjects([first, second]);

			const body = await audit(spaceId);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.total).toBe(2);

			const ids = (body.records as any[]).map((it) => it.id);
			expect(ids).toContain(first);
			expect(ids).toContain(second);

			for (const record of body.records as any[]) {
				expect(record.isUninstalled).toBe(false);
				expect(Number(record.deletedDate)).toBeGreaterThan(0);
			}
		});

		it("orders the audit newest deletion first", async () => {
			const spaceId = await provisionSpace();
			const older = await createObject(spaceId, "Older");
			const newer = await createObject(spaceId, "Newer");

			// Two separate delete calls land distinct deletedDate stamps (a DB round trip apart),
			// so the audit's newest-first order is observable: `newer`, removed last, comes first.
			await deleteObjects([older]);
			await deleteObjects([newer]);

			const body = await audit(spaceId);
			const ids = (body.records as any[]).map((it) => it.id);
			expect(ids).toEqual([newer, older]);
		});

		it("paginates the audit while total stays the full count", async () => {
			const spaceId = await provisionSpace();
			const a = await createObject(spaceId, "A");
			const b = await createObject(spaceId, "B");
			const c = await createObject(spaceId, "C");

			// One delete call stamps a whole batch with the same instant, so remove them one at a
			// time to get three distinct deletedDate values. Newest first: c, b, a.
			await deleteObjects([a]);
			await deleteObjects([b]);
			await deleteObjects([c]);

			const page1 = await audit(spaceId, 0, 2);
			expect(page1.total).toBe(3);
			expect((page1.records as any[]).map((it) => it.id)).toEqual([c, b]);

			const page2 = await audit(spaceId, 2, 2);
			expect(page2.total).toBe(3);
			expect((page2.records as any[]).map((it) => it.id)).toEqual([a]);
		});

		it("forbids a non-member from reading the deletion audit", async () => {
			const spaceId = await provisionSpace();
			const obj = await createObject(spaceId, "Secret");
			await deleteObjects([obj]);

			const body = await audit(spaceId, 0, 100, outsider);
			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});

		it("lets a reader member view the deletion audit", async () => {
			const spaceId = await provisionSpace();
			const obj = await createObject(spaceId, "Shared");
			await deleteObjects([obj]);

			await prisma.spaceMember.create({
				data: {
					spaceId,
					userId: outsider,
					permission: "reader",
					status: "active",
				},
			});

			const body = await audit(spaceId, 0, 100, outsider);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.total).toBe(1);
			expect((body.records as any[]).map((it) => it.id)).toEqual([obj]);
		});

		it("projects deletedBy and creator as participant ids, with type and name", async () => {
			const spaceId = await provisionSpace();
			const { typeId, uniqueKey } = await createType(spaceId, "Recipe");
			const obj = await createTypedObject(spaceId, "Soup", uniqueKey);

			await deleteObjects([obj]);

			const body = await audit(spaceId);
			const record = (body.records as any[]).find((it) => it.id === obj);
			expect(record).toBeDefined();

			// The client renders deletedBy/creator through U.Space.getParticipant, which keys off
			// `_participant_<spaceId>_<accountId>` (registry-service participantId). Both the deleter
			// and the creator here are the owner, so both project to the owner's participant id.
			const participant = `_participant_${spaceId.replace(/\./g, "_")}_${owner}`;
			expect(record.deletedBy).toBe(participant);
			expect(record.creator).toBe(participant);

			expect(record.type).toEqual([typeId]);
			expect(record.name).toBe("Soup");
			expect(Number.isFinite(Number(record.resolvedLayout))).toBe(true);
		});
	},
);
