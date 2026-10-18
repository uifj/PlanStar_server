import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The dataview bulk-edit (block/dataview.tsx:1179) and the multi-object relation popup
// (popup/relation.tsx:222) both send ObjectListModifyDetailValues({ objectIds, operations }) to
// mutate relation values across many records at once. Each operation carries exactly one of
// add / set / remove (a proto oneof) with the value run through Encode.value (identity for a
// string/number, so it reaches the server as-is). The callers pick the verb by relation format:
// `set` for scalar relations and single select, `add`/`remove` for array-valued relations
// (multiSelect tags and object relations). There is no response mapper, so it is write-only
// ({ error, event }). Every relation value — object-format included — is stored in Obj.details
// JSONB via the same store setObjectDetails writes, so a faithful answer mutates that JSONB and
// a subsequent ObjectSubscribeIds read projects it back as record[relationKey]. A bare OK that
// leaves details untouched would be a fake success (tags would never stick); a listed id that
// does not exist answers NOT_FOUND (mirroring ObjectListSetDetails); a non-member is FORBIDDEN
// and the object stays unchanged.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectListModifyDetailValues",
	() => {
		const owner = "modify-detail.owner";
		const outsider = "modify-detail.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Modify detail owner",
						email: "modify-detail-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Modify detail outsider",
						email: "modify-detail-outsider@vanlife.test",
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
			const { account } = await (
				await post("/api/command/AccountSelect", {})
			).json();
			return account.info.accountSpaceId as string;
		};

		// relationFormat 100 is Anytype's object relation (an array-valued relation);
		// relationFormat 1 is shortText (a scalar relation).
		const createRelation = async (
			spaceId: string,
			name: string,
			relationFormat: number,
		) => {
			const created = await (
				await post("/api/command/ObjectCreateRelation", {
					spaceId,
					details: { name, relationFormat },
				})
			).json();
			return created.key as string;
		};

		const createObject = async (spaceId: string, name: string) => {
			const created = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name },
				})
			).json();
			return created.objectId as string;
		};

		const modify = async (objectIds: string[], operations: any[]) => {
			signInAs(owner);
			return (
				await post("/api/command/ObjectListModifyDetailValues", {
					objectIds,
					operations,
				})
			).json();
		};

		const readValue = async (
			spaceId: string,
			objectId: string,
			key: string,
		) => {
			signInAs(owner);
			const subscribed = await (
				await post("/api/command/ObjectSubscribeIds", {
					spaceId,
					subId: `modify-detail-${objectId}`,
					ids: [objectId],
					keys: [],
				})
			).json();
			const record = subscribed.records.find((it: any) => it.id === objectId);
			return record?.[key];
		};

		it("appends to an array relation without clobbering the values already there", async () => {
			const spaceId = await provisionSpace();
			const key = await createRelation(spaceId, "Tags", 100);
			const first = await createObject(spaceId, "Target A");
			const second = await createObject(spaceId, "Target B");
			const objectId = await createObject(spaceId, "Record");

			expect(
				(await modify([objectId], [{ relationKey: key, add: [first] }])).error,
			).toEqual({ code: 0, description: "" });
			expect(await readValue(spaceId, objectId, key)).toEqual([first]);

			await modify([objectId], [{ relationKey: key, add: [second] }]);
			expect(await readValue(spaceId, objectId, key)).toEqual([first, second]);
		});

		it("does not duplicate a value that is already present", async () => {
			const spaceId = await provisionSpace();
			const key = await createRelation(spaceId, "Tags", 100);
			const target = await createObject(spaceId, "Target");
			const objectId = await createObject(spaceId, "Record");
			await modify([objectId], [{ relationKey: key, add: [target] }]);

			await modify([objectId], [{ relationKey: key, add: [target] }]);
			expect(await readValue(spaceId, objectId, key)).toEqual([target]);
		});

		it("removes a value from an array relation", async () => {
			const spaceId = await provisionSpace();
			const key = await createRelation(spaceId, "Tags", 100);
			const keep = await createObject(spaceId, "Keep");
			const drop = await createObject(spaceId, "Drop");
			const objectId = await createObject(spaceId, "Record");
			await modify([objectId], [{ relationKey: key, add: [keep, drop] }]);

			await modify([objectId], [{ relationKey: key, remove: [drop] }]);
			expect(await readValue(spaceId, objectId, key)).toEqual([keep]);
		});

		it("replaces the whole value list on set", async () => {
			const spaceId = await provisionSpace();
			const key = await createRelation(spaceId, "Tags", 100);
			const old = await createObject(spaceId, "Old");
			const fresh = await createObject(spaceId, "Fresh");
			const objectId = await createObject(spaceId, "Record");
			await modify([objectId], [{ relationKey: key, add: [old] }]);

			await modify([objectId], [{ relationKey: key, set: [fresh] }]);
			expect(await readValue(spaceId, objectId, key)).toEqual([fresh]);
		});

		it("sets a scalar relation value", async () => {
			const spaceId = await provisionSpace();
			const key = await createRelation(spaceId, "Subtitle", 1);
			const objectId = await createObject(spaceId, "Record");

			await modify([objectId], [{ relationKey: key, set: "hello" }]);
			expect(await readValue(spaceId, objectId, key)).toBe("hello");
		});

		it("applies one batch of operations across every listed object", async () => {
			const spaceId = await provisionSpace();
			const key = await createRelation(spaceId, "Tags", 100);
			const target = await createObject(spaceId, "Shared");
			const a = await createObject(spaceId, "Record A");
			const b = await createObject(spaceId, "Record B");

			const body = await modify([a, b], [{ relationKey: key, add: [target] }]);
			expect(body.error).toEqual({ code: 0, description: "" });

			expect(await readValue(spaceId, a, key)).toEqual([target]);
			expect(await readValue(spaceId, b, key)).toEqual([target]);
		});

		it("answers NOT_FOUND when a listed object does not exist", async () => {
			const spaceId = await provisionSpace();
			const key = await createRelation(spaceId, "Tags", 100);
			const target = await createObject(spaceId, "Target");

			const body = await modify(
				["missing-one", "missing-two"],
				[{ relationKey: key, add: [target] }],
			);
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("forbids a non-member and leaves the object unchanged", async () => {
			const spaceId = await provisionSpace();
			const key = await createRelation(spaceId, "Tags", 100);
			const existing = await createObject(spaceId, "Existing");
			const intruder = await createObject(spaceId, "Intruder");
			const objectId = await createObject(spaceId, "Record");
			await modify([objectId], [{ relationKey: key, add: [existing] }]);

			signInAs(outsider);
			const body = await (
				await post("/api/command/ObjectListModifyDetailValues", {
					objectIds: [objectId],
					operations: [{ relationKey: key, add: [intruder] }],
				})
			).json();
			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});

			expect(await readValue(spaceId, objectId, key)).toEqual([existing]);
		});
	},
);
