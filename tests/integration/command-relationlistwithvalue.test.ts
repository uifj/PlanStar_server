import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The date page asks RelationListWithValue({ spaceId, value }) which relations reference an
// object, so it can list "what points at this date" (date.tsx:69; response.ts:797 maps
// response.list -> { relations: [{ relationKey, counter }] }). `value` is the date object's id
// (Encode.value is identity for a string). Every relation value — object-format included — is
// written through ObjectListSetDetails into Obj.details JSONB (block/relation.tsx:80 ->
// object-service setObjectDetails), not into Link, so a faithful answer reads the details JSONB:
// for each object-format relation in the space, count the non-deleted objects whose value list
// contains the id. A bare empty list would be a fake success (the date page would never show its
// references); a non-member is FORBIDDEN.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/RelationListWithValue",
	() => {
		const owner = "rel-value.owner";
		const outsider = "rel-value.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Relation value owner",
						email: "rel-value-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Relation value outsider",
						email: "rel-value-outsider@vanlife.test",
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

		// relationFormat 100 is Anytype's object relation (I.RelationType.OBJECT).
		const createObjectRelation = async (spaceId: string, name: string) => {
			const created = await (
				await post("/api/command/ObjectCreateRelation", {
					spaceId,
					details: { name, relationFormat: 100 },
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

		// Point `fromId` at `toId` through an object relation, via the client's real write path.
		const setRelation = async (fromId: string, key: string, toId: string) => {
			await post("/api/command/ObjectListSetDetails", {
				objectIds: [fromId],
				details: [{ id: fromId, details: { [key]: [toId] } }],
			});
		};

		const listWithValue = async (spaceId: string, value: string) => {
			signInAs(owner);
			const body = await (
				await post("/api/command/RelationListWithValue", { spaceId, value })
			).json();
			return body;
		};

		it("counts the objects that reference a value through an object relation", async () => {
			const spaceId = await provisionSpace();
			const key = await createObjectRelation(spaceId, "Due date");
			const target = await createObject(spaceId, "Monday");
			const a = await createObject(spaceId, "Task A");
			const b = await createObject(spaceId, "Task B");
			await setRelation(a, key, target);
			await setRelation(b, key, target);

			const body = await listWithValue(spaceId, target);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.list).toEqual([{ relationKey: key, counter: 2 }]);
		});

		it("omits an object relation that nothing references", async () => {
			const spaceId = await provisionSpace();
			const used = await createObjectRelation(spaceId, "Author");
			const unused = await createObjectRelation(spaceId, "Editor");
			const target = await createObject(spaceId, "Person");
			const post1 = await createObject(spaceId, "Post");
			await setRelation(post1, used, target);

			const body = await listWithValue(spaceId, target);
			expect(body.list).toEqual([{ relationKey: used, counter: 1 }]);
			expect(body.list.some((it: any) => it.relationKey === unused)).toBe(
				false,
			);
		});

		it("returns an empty list when nothing references the value", async () => {
			const spaceId = await provisionSpace();
			await createObjectRelation(spaceId, "Due date");
			const lonely = await createObject(spaceId, "Unreferenced");

			const body = await listWithValue(spaceId, lonely);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.list).toEqual([]);
		});

		it("does not count a reference to a different object", async () => {
			const spaceId = await provisionSpace();
			const key = await createObjectRelation(spaceId, "Due date");
			const target = await createObject(spaceId, "Monday");
			const other = await createObject(spaceId, "Tuesday");
			const task = await createObject(spaceId, "Task");
			await setRelation(task, key, other);

			expect((await listWithValue(spaceId, target)).list).toEqual([]);
			expect((await listWithValue(spaceId, other)).list).toEqual([
				{ relationKey: key, counter: 1 },
			]);
		});

		it("forbids a non-member", async () => {
			const spaceId = await provisionSpace();
			const key = await createObjectRelation(spaceId, "Due date");
			const target = await createObject(spaceId, "Monday");
			const task = await createObject(spaceId, "Task");
			await setRelation(task, key, target);

			signInAs(outsider);
			const body = await (
				await post("/api/command/RelationListWithValue", {
					spaceId,
					value: target,
				})
			).json();

			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
