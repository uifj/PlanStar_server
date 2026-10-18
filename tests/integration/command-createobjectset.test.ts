import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The dataview "new set" flows send ObjectCreateSet({ source, details, templateId, spaceId })
// (dataview.tsx:964, dataview/head.tsx:134, menu/block/action.tsx:556, page/main/relation.tsx:115)
// and open the returned object as a set. Unlike ObjectToSet, which flips an existing object, this
// must mint a brand-new Obj whose resolvedLayout is "set" and whose sources ride on details.setOf,
// then answer { objectId, details } with the Set layout number (3) so the client renders a dataview
// and not a page. A bare OK, or a page-layout object, would be a fake success; a non-member must be
// refused rather than allowed to plant a set in someone else's space.
describe.skipIf(!databaseAvailable)("POST /api/command/ObjectCreateSet", () => {
	const owner = "create-set.owner";
	const outsider = "create-set.outsider";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: owner,
					name: "Set owner",
					email: "create-set-owner@vanlife.test",
				},
				{
					id: outsider,
					name: "Set outsider",
					email: "create-set-outsider@vanlife.test",
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
		return created.objectId as string;
	};

	it("creates a set object and returns its Set-layout detail with its sources", async () => {
		const spaceId = await provisionSpace();
		const sourceType = await createType(spaceId, "Recipe");

		const body = await (
			await post("/api/command/ObjectCreateSet", {
				source: [sourceType],
				details: { name: "All recipes" },
				templateId: "",
				spaceId,
			})
		).json();

		expect(body.error).toEqual({ code: 0, description: "" });
		expect(typeof body.objectId).toBe("string");
		expect(body.objectId.length).toBeGreaterThan(0);
		// Anytype I.ObjectLayout.Set === 3; the sources are the type ids the set queries.
		expect(body.details.id).toBe(body.objectId);
		expect(body.details.name).toBe("All recipes");
		expect(body.details.layout).toBe(3);
		expect(body.details.setOf).toEqual([sourceType]);
	});

	it("persists the set so a later read projects the Set layout", async () => {
		const spaceId = await provisionSpace();
		const sourceType = await createType(spaceId, "Task");

		const created = await (
			await post("/api/command/ObjectCreateSet", {
				source: [sourceType],
				details: { name: "All tasks" },
				templateId: "",
				spaceId,
			})
		).json();
		const objectId = created.objectId as string;

		const subscribed = await (
			await post("/api/command/ObjectSubscribeIds", {
				spaceId,
				subId: `create-set-${objectId}`,
				ids: [objectId],
				keys: [],
			})
		).json();
		const record = subscribed.records.find((it: any) => it.id === objectId);
		expect(record).toBeDefined();
		expect(record.layout).toBe(3);
		expect(record.resolvedLayout).toBe(3);
	});

	it("creates a set with no sources as an empty Set", async () => {
		const spaceId = await provisionSpace();

		const body = await (
			await post("/api/command/ObjectCreateSet", {
				source: [],
				details: { name: "Blank set" },
				templateId: "",
				spaceId,
			})
		).json();

		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.details.layout).toBe(3);
		expect(body.details.setOf).toEqual([]);
	});

	it("forbids a non-member from creating a set in the space", async () => {
		const spaceId = await provisionSpace();

		signInAs(outsider);
		const body = await (
			await post("/api/command/ObjectCreateSet", {
				source: [],
				details: { name: "Intruder set" },
				templateId: "",
				spaceId,
			})
		).json();

		expect(body.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
	});
});
