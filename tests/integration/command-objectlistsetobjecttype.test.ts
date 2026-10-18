import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The multi-select "change type" action sends ObjectListSetObjectType({ objectIds, objectTypeUniqueKey })
// with the type's uniqueKey — not its id (menu/object/context.tsx:299) — and is fire-and-forget (no
// response mapper). It is the batch sibling of ObjectSetObjectType (#134): every listed object must be
// re-pointed at the type resolved by uniqueKey within that object's own space, so a subsequent read
// projects `type: [typeId]`. A bare OK that leaves objects untyped would be a fake success. Unknown ids
// are ignored (the real ones still retype); when nothing was retyped the command answers NOT_FOUND; a
// non-member is FORBIDDEN and objects stay unchanged.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectListSetObjectType",
	() => {
		const owner = "list-type.owner";
		const outsider = "list-type.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "List type owner",
						email: "list-type-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "List type outsider",
						email: "list-type-outsider@vanlife.test",
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

		const createType = async (spaceId: string, name: string) => {
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
			const created = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name },
					internalFlags: [],
				})
			).json();
			return created.objectId as string;
		};

		const setType = async (objectId: string, uniqueKey: string) => {
			await post("/api/command/ObjectSetObjectType", {
				contextId: objectId,
				objectTypeUniqueKey: uniqueKey,
			});
		};

		const recordType = async (spaceId: string, objectId: string) => {
			signInAs(owner);
			const subscribed = await (
				await post("/api/command/ObjectSubscribeIds", {
					spaceId,
					subId: `list-type-${objectId}`,
					ids: [objectId],
					keys: [],
				})
			).json();
			const record = subscribed.records.find((it: any) => it.id === objectId);
			return record?.type;
		};

		it("re-points every listed object at the type resolved by its unique key", async () => {
			const spaceId = await provisionSpace();
			const { typeId, uniqueKey } = await createType(spaceId, "Recipe");
			const first = await createObject(spaceId, "Soup");
			const second = await createObject(spaceId, "Stew");

			const body = await (
				await post("/api/command/ObjectListSetObjectType", {
					objectIds: [first, second],
					objectTypeUniqueKey: uniqueKey,
				})
			).json();
			expect(body.error).toEqual({ code: 0, description: "" });

			expect(await recordType(spaceId, first)).toEqual([typeId]);
			expect(await recordType(spaceId, second)).toEqual([typeId]);
		});

		it("answers NOT_FOUND for an unknown type key and leaves the object unchanged", async () => {
			const spaceId = await provisionSpace();
			const { typeId, uniqueKey } = await createType(spaceId, "Recipe");
			const objectId = await createObject(spaceId, "Soup");
			await setType(objectId, uniqueKey);

			const body = await (
				await post("/api/command/ObjectListSetObjectType", {
					objectIds: [objectId],
					objectTypeUniqueKey: "no-such-type-key",
				})
			).json();
			expect(body.error).toEqual({ code: 3, description: "Object not found." });

			expect(await recordType(spaceId, objectId)).toEqual([typeId]);
		});

		it("answers NOT_FOUND when none of the listed objects exist", async () => {
			const spaceId = await provisionSpace();
			const { uniqueKey } = await createType(spaceId, "Note");

			const body = await (
				await post("/api/command/ObjectListSetObjectType", {
					objectIds: ["missing-one", "missing-two"],
					objectTypeUniqueKey: uniqueKey,
				})
			).json();

			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("ignores unknown ids and retypes the real one", async () => {
			const spaceId = await provisionSpace();
			const { typeId, uniqueKey } = await createType(spaceId, "Recipe");
			const objectId = await createObject(spaceId, "Soup");

			const body = await (
				await post("/api/command/ObjectListSetObjectType", {
					objectIds: [objectId, "missing-id"],
					objectTypeUniqueKey: uniqueKey,
				})
			).json();
			expect(body.error).toEqual({ code: 0, description: "" });

			expect(await recordType(spaceId, objectId)).toEqual([typeId]);
		});

		it("forbids a non-member and leaves the object unchanged", async () => {
			const spaceId = await provisionSpace();
			const { typeId, uniqueKey } = await createType(spaceId, "Task A");
			const { uniqueKey: otherKey } = await createType(spaceId, "Task B");
			const objectId = await createObject(spaceId, "Blocked");
			await setType(objectId, uniqueKey);

			signInAs(outsider);
			const body = await (
				await post("/api/command/ObjectListSetObjectType", {
					objectIds: [objectId],
					objectTypeUniqueKey: otherKey,
				})
			).json();
			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});

			expect(await recordType(spaceId, objectId)).toEqual([typeId]);
		});
	},
);
