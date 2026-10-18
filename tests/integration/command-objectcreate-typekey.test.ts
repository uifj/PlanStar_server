import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ObjectCreate carries the chosen type as `objectTypeUniqueKey` (command.ts:1174), not as a
// details.type id array — the type rail's "new <Type>" and the template creator both rely on it.
// The shim must resolve that key to the space's ObjectType and set Obj.typeId, so a read projects
// `type: [typeId]`. Leaving it untyped would silently drop the user's type choice (and break the
// template feature, which creates with typeKey ot-template). An unknown key resolves to nothing and
// the object stays untyped rather than failing.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectCreate (objectTypeUniqueKey)",
	() => {
		const owner = "obj-create-type.owner";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Object create type owner",
						email: "obj-create-type-owner@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({ where: { id: owner } });
		});

		const provisionSpace = async () => {
			signInAs(owner);
			const { account } = await (
				await post("/api/command/AccountSelect", {})
			).json();
			return account.info.accountSpaceId as string;
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

		const createObject = async (
			spaceId: string,
			name: string,
			objectTypeUniqueKey?: string,
		) => {
			signInAs(owner);
			const created = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name },
					internalFlags: [],
					...(objectTypeUniqueKey ? { objectTypeUniqueKey } : {}),
				})
			).json();
			return created.objectId as string;
		};

		const typeOf = async (spaceId: string, objectId: string) => {
			signInAs(owner);
			const body = await (
				await post("/api/command/ObjectSubscribeIds", {
					spaceId,
					subId: `obj-create-type-${objectId}`,
					ids: [objectId],
					keys: [],
				})
			).json();
			const record = body.records.find((it: any) => it.id === objectId);
			return record?.type as string[] | undefined;
		};

		it("types a new object from objectTypeUniqueKey", async () => {
			const spaceId = await provisionSpace();
			const { typeId, uniqueKey } = await createType(spaceId, "Recipe");

			const objectId = await createObject(spaceId, "Soup", uniqueKey);

			expect(await typeOf(spaceId, objectId)).toEqual([typeId]);
		});

		it("leaves an object untyped for an unknown objectTypeUniqueKey", async () => {
			const spaceId = await provisionSpace();

			const objectId = await createObject(
				spaceId,
				"Orphan",
				"no-such-type-key",
			);

			expect(await typeOf(spaceId, objectId)).toEqual([]);
		});
	},
);
