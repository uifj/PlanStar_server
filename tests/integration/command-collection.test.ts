import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// P4 collections: a collection is an ordered set of member objects. Membership is an
// object-valued relation, so Link is its sole store (ADR-0002): ObjectCollectionAdd /
// ObjectCollectionRemove write the ordered edges and the client reads them back through
// ObjectSearchSubscribe carrying collectionId (lib/dataview.ts getRecords).
describe.skipIf(!databaseAvailable)(
	"POST /api/command collection membership",
	() => {
		const ownerId = "command-collection.owner";
		const outsiderId = "command-collection.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Collection owner",
						email: "command-collection-owner@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Collection outsider",
						email: "command-collection-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: ownerId } });
			await prisma.user.deleteMany({
				where: { id: { in: [ownerId, outsiderId] } },
			});
		});

		const createSpace = async () => {
			signInAs(ownerId);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Collection space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		const createObject = async (spaceId: string, name: string) => {
			signInAs(ownerId);
			const { objectId } = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name },
				})
			).json();
			return objectId as string;
		};

		const collectionAdd = async (contextId: string, objectIds: string[]) => {
			signInAs(ownerId);
			return (
				await post("/api/command/ObjectCollectionAdd", {
					contextId,
					objectIds,
				})
			).json();
		};

		const subscribe = async (
			spaceId: string,
			collectionId: string,
			filters: unknown[] = [],
		) => {
			signInAs(ownerId);
			const body = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `collection-${collectionId}`,
					filters,
					sorts: [],
					keys: [],
					sources: [],
					offset: 0,
					limit: 50,
					afterId: "",
					beforeId: "",
					noDeps: false,
					collectionId,
				})
			).json();
			return body;
		};

		it("adds members in order and reads them back through the collection subscription", async () => {
			const spaceId = await createSpace();
			const collectionId = await createObject(spaceId, "Roadtrip stops");
			const first = await createObject(spaceId, "Alpha stop");
			const second = await createObject(spaceId, "Beta stop");
			const third = await createObject(spaceId, "Gamma stop");

			const added = await collectionAdd(collectionId, [first, second, third]);
			expect(added.error).toEqual({ code: 0, description: "" });

			const body = await subscribe(spaceId, collectionId);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.records.map((it: any) => it.id)).toEqual([
				first,
				second,
				third,
			]);
		});

		it("appends later additions after existing members", async () => {
			const spaceId = await createSpace();
			const collectionId = await createObject(spaceId, "Queue");
			const first = await createObject(spaceId, "First");
			const second = await createObject(spaceId, "Second");

			await collectionAdd(collectionId, [first]);
			await collectionAdd(collectionId, [second]);

			const body = await subscribe(spaceId, collectionId);
			expect(body.records.map((it: any) => it.id)).toEqual([first, second]);
		});

		it("removes a member", async () => {
			const spaceId = await createSpace();
			const collectionId = await createObject(spaceId, "Shelf");
			const keep = await createObject(spaceId, "Keep me");
			const drop = await createObject(spaceId, "Drop me");

			await collectionAdd(collectionId, [keep, drop]);

			signInAs(ownerId);
			const removed = await (
				await post("/api/command/ObjectCollectionRemove", {
					contextId: collectionId,
					objectIds: [drop],
				})
			).json();
			expect(removed.error).toEqual({ code: 0, description: "" });

			const body = await subscribe(spaceId, collectionId);
			expect(body.records.map((it: any) => it.id)).toEqual([keep]);
		});

		it("narrows members to a filter while preserving the stored order", async () => {
			const spaceId = await createSpace();
			const collectionId = await createObject(spaceId, "Filtered shelf");
			const zulu = await createObject(spaceId, "Zulu keep");
			const alpha = await createObject(spaceId, "Alpha keep");
			const drop = await createObject(spaceId, "Drop me");

			await collectionAdd(collectionId, [zulu, alpha, drop]);

			// Anytype Mapper.To.Filter wire shape: RelationKey + numeric condition (Like === 7)
			// + the raw value. The manual order is authoritative, so the two matches come back
			// in stored order, not name order.
			const body = await subscribe(spaceId, collectionId, [
				{
					id: "filter-name",
					RelationKey: "name",
					format: 1,
					operator: 2,
					condition: 7,
					value: "keep",
				},
			]);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.records.map((it: any) => it.id)).toEqual([zulu, alpha]);
		});

		it("denies a write from a caller who cannot write the space", async () => {
			const spaceId = await createSpace();
			const collectionId = await createObject(spaceId, "Private shelf");
			const member = await createObject(spaceId, "Member");

			signInAs(outsiderId);
			const res = await post("/api/command/ObjectCollectionAdd", {
				contextId: collectionId,
				objectIds: [member],
			});
			expect((await res.json()).error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
