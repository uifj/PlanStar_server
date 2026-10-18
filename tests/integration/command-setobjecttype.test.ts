import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The featured type picker sends ObjectSetObjectType({ contextId, objectTypeUniqueKey })
// with the type's uniqueKey — not its id (featured.tsx:376) — and only checks error.code.
// The shim must resolve the type within the object's space and re-point Obj.typeId, so a
// subsequent read projects `type: [typeId]`. A bare OK that leaves the object untyped would
// be a fake success; an unknown key or object must answer NOT_FOUND, a non-member FORBIDDEN.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectSetObjectType",
	() => {
		const owner = "set-type.owner";
		const outsider = "set-type.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Type owner",
						email: "set-type-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Type outsider",
						email: "set-type-outsider@vanlife.test",
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

		it("re-points an object at a type resolved by its unique key", async () => {
			const spaceId = await provisionSpace();
			const { typeId, uniqueKey } = await createType(spaceId, "Recipe");
			const objectId = await createObject(spaceId, "Soup");

			const body = await (
				await post("/api/command/ObjectSetObjectType", {
					contextId: objectId,
					objectTypeUniqueKey: uniqueKey,
				})
			).json();
			expect(body.error).toEqual({ code: 0, description: "" });

			// A read of the object now projects the new type as its `type` relation.
			const subscribed = await (
				await post("/api/command/ObjectSubscribeIds", {
					spaceId,
					subId: `set-type-${objectId}`,
					ids: [objectId],
					keys: [],
				})
			).json();
			const record = subscribed.records.find((it: any) => it.id === objectId);
			expect(record).toBeDefined();
			expect(record.type).toEqual([typeId]);
		});

		it("answers NOT_FOUND for an unknown type key", async () => {
			const spaceId = await provisionSpace();
			const objectId = await createObject(spaceId, "Orphan");

			const body = await (
				await post("/api/command/ObjectSetObjectType", {
					contextId: objectId,
					objectTypeUniqueKey: "no-such-type-key",
				})
			).json();

			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("answers NOT_FOUND for an unknown object", async () => {
			const spaceId = await provisionSpace();
			const { uniqueKey } = await createType(spaceId, "Note");

			const body = await (
				await post("/api/command/ObjectSetObjectType", {
					contextId: "missing-object-id",
					objectTypeUniqueKey: uniqueKey,
				})
			).json();

			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("forbids a non-member from re-typing an object", async () => {
			const spaceId = await provisionSpace();
			const { uniqueKey } = await createType(spaceId, "Task");
			const objectId = await createObject(spaceId, "Blocked");

			signInAs(outsider);
			const body = await (
				await post("/api/command/ObjectSetObjectType", {
					contextId: objectId,
					objectTypeUniqueKey: uniqueKey,
				})
			).json();

			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
