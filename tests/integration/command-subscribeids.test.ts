import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The client hydrates the details of a known set of object ids through
// ObjectSubscribeIds({ spaceId, subId, ids, keys, noDepSubscription }) (command.ts:1509);
// the response mapper reads { records, dependencies } (response.ts:354). The shim must
// answer with the object records for the ids that exist in the space, in the requested
// order, so referenced objects (a relation's value, a collection's members) resolve.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectSubscribeIds",
	() => {
		const owner = "subscribe-ids.owner";
		const outsider = "subscribe-ids.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Subscribe owner",
						email: "subscribe-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Subscribe outsider",
						email: "subscribe-outsider@vanlife.test",
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

		const createSpace = async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Subscribe space" },
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

		it("returns the records for the requested ids in request order", async () => {
			const spaceId = await createSpace();
			const first = await createObject(spaceId, "First");
			const second = await createObject(spaceId, "Second");

			signInAs(owner);
			const body = await (
				await post("/api/command/ObjectSubscribeIds", {
					spaceId,
					subId: `ids-${spaceId}`,
					// Request out of creation order and include an id that does not exist;
					// the records come back in the requested order, missing ids omitted.
					ids: [second, "missing-id", first],
					keys: [],
					noDepSubscription: true,
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.records.map((it: any) => it.id)).toEqual([second, first]);
			expect(body.records.map((it: any) => it.name)).toEqual([
				"Second",
				"First",
			]);
			expect(body.dependencies).toEqual([]);
		});

		it("forbids a non-member from subscribing to ids in the space", async () => {
			const spaceId = await createSpace();
			const obj = await createObject(spaceId, "Guarded");

			signInAs(outsider);
			const body = await (
				await post("/api/command/ObjectSubscribeIds", {
					spaceId,
					subId: `ids-${spaceId}`,
					ids: [obj],
					keys: [],
					noDepSubscription: true,
				})
			).json();

			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
