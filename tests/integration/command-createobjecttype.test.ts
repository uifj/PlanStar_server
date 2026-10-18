import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The type picker's "add" row sends ObjectCreateObjectType({ name }) with no key
// (suggest.tsx:196) and feeds message.details straight into S.Detail.mapper, so the
// shim must mint a registry-unique key, create a real ObjectType row, and answer with
// the full type record (layout 4). A bare OK — or a type that never reaches the
// type-<spaceId> subscription — would be a fake success.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectCreateObjectType",
	() => {
		const owner = "create-type.owner";
		const outsider = "create-type.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Type owner",
						email: "type-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Type outsider",
						email: "type-outsider@vanlife.test",
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

		it("creates a custom type and returns its type record", async () => {
			const spaceId = await provisionSpace();

			const body = await (
				await post("/api/command/ObjectCreateObjectType", {
					spaceId,
					details: { name: "Recipe" },
					internalFlags: [],
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(typeof body.objectId).toBe("string");
			expect(body.objectId.length).toBeGreaterThan(0);
			expect(body.details.id).toBe(body.objectId);
			expect(body.details.name).toBe("Recipe");
			// I.ObjectLayout.Type === 4; the picker and U.Object.isTypeLayout read it.
			expect(body.details.layout).toBe(4);
			expect(body.details.resolvedLayout).toBe(4);
			// The minted key satisfies the registry's uniqueKey contract.
			expect(body.details.uniqueKey).toMatch(/^[a-z][a-zA-Z0-9]*$/);
		});

		it("makes the new type readable through the type subscription", async () => {
			const spaceId = await provisionSpace();

			const created = await (
				await post("/api/command/ObjectCreateObjectType", {
					spaceId,
					details: { name: "Itinerary" },
					internalFlags: [],
				})
			).json();

			const subscribed = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `type-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
				})
			).json();

			const match = subscribed.records.find(
				(it: any) => it.id === created.objectId,
			);
			expect(match).toBeDefined();
			expect(match.name).toBe("Itinerary");
			expect(match.layout).toBe(4);
		});

		it("mints a distinct key for two types created with the same name", async () => {
			const spaceId = await provisionSpace();

			const first = await (
				await post("/api/command/ObjectCreateObjectType", {
					spaceId,
					details: { name: "Note" },
					internalFlags: [],
				})
			).json();
			const second = await (
				await post("/api/command/ObjectCreateObjectType", {
					spaceId,
					details: { name: "Note" },
					internalFlags: [],
				})
			).json();

			expect(first.error).toEqual({ code: 0, description: "" });
			expect(second.error).toEqual({ code: 0, description: "" });
			expect(second.objectId).not.toBe(first.objectId);
			expect(second.details.uniqueKey).not.toBe(first.details.uniqueKey);
		});

		it("forbids a non-member from creating a type in the space", async () => {
			const spaceId = await provisionSpace();

			signInAs(outsider);
			const body = await (
				await post("/api/command/ObjectCreateObjectType", {
					spaceId,
					details: { name: "Intruder" },
					internalFlags: [],
				})
			).json();

			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
