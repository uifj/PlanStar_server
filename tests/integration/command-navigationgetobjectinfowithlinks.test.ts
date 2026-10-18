import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The graph "navigation" page (page/main/navigation.tsx:190) sends
// NavigationGetObjectInfoWithLinks({ objectId }) for the focused object and renders three
// columns: the object itself (center), the objects it links out to (right), and the objects
// that link back to it (left). response.ts:593 maps the answer to
// { object: { id, info: ObjectInfo, links: { inbound: ObjectInfo[], outbound: ObjectInfo[] } } }
// and Mapper.From.ObjectInfo (mapper.ts:159) reads { id, details, snippet, hasInboundLinks }; the
// page consumes only item.details (getPage spreads S.Detail.mapper(details), filterMapper keeps
// it.id && !it.isDeleted). Command-created object relations are NOT written to the Link table
// (ADR-0002) — they live in Obj.details JSONB as details[relationKey] = [targetId, ...] — so a
// faithful answer computes both directions from that store: outbound = this object's
// object-relation targets (existing, non-deleted, stored order, deduped, self excluded);
// inbound = the space's other non-deleted objects whose object-relation value list contains this
// id. A bare { object: {} } would render three empty columns (a fake success); an unknown object
// answers NOT_FOUND and a non-member is FORBIDDEN (auth resolved from the object's own spaceId).
describe.skipIf(!databaseAvailable)(
	"POST /api/command/NavigationGetObjectInfoWithLinks",
	() => {
		const owner = "navigation.owner";
		const outsider = "navigation.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Navigation owner",
						email: "navigation-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Navigation outsider",
						email: "navigation-outsider@vanlife.test",
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

		// relationFormat 100 is Anytype's object relation (an array of target ids).
		const createRelation = async (spaceId: string, name: string) => {
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

		// Point `fromId` at `toId` through the object-relation `key` via the client's own
		// write path (ObjectListSetDetails stores details[key] = [toId] in the JSONB).
		const link = async (fromId: string, key: string, toId: string) => {
			signInAs(owner);
			await post("/api/command/ObjectListSetDetails", {
				details: [{ id: fromId, details: { [key]: [toId] } }],
			});
		};

		const nav = async (objectId: string) => {
			signInAs(owner);
			return (
				await post("/api/command/NavigationGetObjectInfoWithLinks", {
					objectId,
				})
			).json();
		};

		it("returns the central object and the objects it links out to", async () => {
			const spaceId = await provisionSpace();
			const key = await createRelation(spaceId, "Links To");
			const a = await createObject(spaceId, "A");
			const b = await createObject(spaceId, "B");
			await link(a, key, b);

			const { object, error } = await nav(a);
			expect(error).toEqual({ code: 0, description: "" });
			expect(object.id).toBe(a);
			expect(object.info.id).toBe(a);
			expect(object.info.details.id).toBe(a);
			expect(object.info.details.name).toBe("A");
			expect(object.links.outbound.map((it: any) => it.details.id)).toEqual([
				b,
			]);
			expect(object.links.inbound).toEqual([]);
		});

		it("returns the objects that link back to the central object", async () => {
			const spaceId = await provisionSpace();
			const key = await createRelation(spaceId, "Links To");
			const a = await createObject(spaceId, "A");
			const b = await createObject(spaceId, "B");
			await link(a, key, b);

			const { object } = await nav(b);
			expect(object.id).toBe(b);
			expect(object.info.hasInboundLinks).toBe(true);
			expect(object.links.inbound.map((it: any) => it.details.id)).toEqual([a]);
			expect(object.links.outbound).toEqual([]);
		});

		it("returns empty link lists for an object with no object relations", async () => {
			const spaceId = await provisionSpace();
			const lonely = await createObject(spaceId, "Lonely");

			const { object } = await nav(lonely);
			expect(object.id).toBe(lonely);
			expect(object.info.hasInboundLinks).toBe(false);
			expect(object.links.inbound).toEqual([]);
			expect(object.links.outbound).toEqual([]);
		});

		it("answers NOT_FOUND for an unknown object", async () => {
			await provisionSpace();

			const body = await nav("missing-object");
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("forbids a caller who is not a member of the object's space", async () => {
			const spaceId = await provisionSpace();
			const key = await createRelation(spaceId, "Links To");
			const a = await createObject(spaceId, "A");
			const b = await createObject(spaceId, "B");
			await link(a, key, b);

			signInAs(outsider);
			const body = await (
				await post("/api/command/NavigationGetObjectInfoWithLinks", {
					objectId: a,
				})
			).json();
			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
