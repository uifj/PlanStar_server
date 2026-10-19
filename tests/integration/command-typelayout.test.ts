import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// A type's Layout section writes `recommendedLayout` through ObjectListSetDetails
// (sidebar/section/type/layout.tsx:36 → sidebar/page/type.tsx:175), and its header offers
// "Reset to match the Type", which dispatches ObjectTypeResolveLayoutConflicts with no callback
// (page/elements/head/simple.tsx:248). For that recommendation to mean anything, ObjectCreate has to
// inherit it and the reset command has to apply it to the objects that were made before it changed.
// Layout numbers are the client's own (front_web interface/object.ts): Page 0, Task 2.
describe.skipIf(!databaseAvailable)("Type recommended layout", () => {
	const owner = "layout.owner";
	const reader = "layout.reader";

	let spaceId = "";
	let typeId = "";
	let typeKey = "";

	const TASK = 2;
	const PAGE = 0;

	beforeAll(async () => {
		for (const id of [owner, reader]) {
			await prisma.obj.deleteMany({ where: { creatorId: id } });
			await prisma.spaceMember.deleteMany({ where: { userId: id } });
			await prisma.user.deleteMany({ where: { id } });
			await prisma.user.create({
				data: { id, name: "Layout probe", email: `${id}@vanlife.test` },
			});
		}

		signInAs(owner);
		const { account } = await (
			await post("/api/command/AccountSelect", {})
		).json();
		spaceId = account.info.accountSpaceId as string;

		const created = await (
			await post("/api/command/ObjectCreateObjectType", {
				spaceId,
				details: { name: "Errand" },
				internalFlags: [],
			})
		).json();
		typeId = created.objectId as string;
		typeKey = created.details.uniqueKey as string;

		await prisma.spaceMember.create({
			data: { spaceId, userId: reader, permission: "reader", status: "active" },
		});
	});

	afterAll(async () => {
		await prisma.obj.deleteMany({ where: { typeId } });
		await prisma.obj.deleteMany({ where: { id: typeId } });
	});

	const recommend = async (layout: number) => {
		signInAs(owner);
		const res = await (
			await post("/api/command/ObjectListSetDetails", {
				objectIds: [typeId],
				details: [{ id: typeId, details: { recommendedLayout: layout } }],
			})
		).json();
		expect(res.error.code).toBe(0);
	};

	const createObject = async (name: string) => {
		signInAs(owner);
		const created = await (
			await post("/api/command/ObjectCreate", {
				spaceId,
				details: { name },
				internalFlags: [],
				objectTypeUniqueKey: typeKey,
			})
		).json();
		return created.objectId as string;
	};

	const layoutOf = async (objectId: string, as = owner) => {
		signInAs(as);
		const body = await (
			await post("/api/command/ObjectSubscribeIds", {
				spaceId,
				subId: `layout-${objectId}-${as}`,
				ids: [objectId],
				keys: [],
			})
		).json();
		return body.records.find((it: any) => it.id === objectId)?.layout as number;
	};

	const resolve = async (id = typeId, as = owner) => {
		signInAs(as);
		return (
			await post("/api/command/ObjectTypeResolveLayoutConflicts", {
				typeObjectId: id,
			})
		).json();
	};

	it("gives a new object the layout its type recommends", async () => {
		await recommend(TASK);

		const objectId = await createObject("Buy milk");

		expect(await layoutOf(objectId)).toBe(TASK);
	});

	it("keeps the page layout for a type that recommends nothing", async () => {
		const plain = await (
			await post("/api/command/ObjectCreateObjectType", {
				spaceId,
				details: { name: "Unrecommending" },
				internalFlags: [],
			})
		).json();

		signInAs(owner);
		const created = await (
			await post("/api/command/ObjectCreate", {
				spaceId,
				details: { name: "Plain" },
				internalFlags: [],
				objectTypeUniqueKey: plain.details.uniqueKey,
			})
		).json();

		expect(await layoutOf(created.objectId)).toBe(PAGE);
	});

	it("resets the objects that were made before the recommendation", async () => {
		await recommend(PAGE);
		const objectId = await createObject("Old errand");
		expect(await layoutOf(objectId)).toBe(PAGE);

		await recommend(TASK);
		// Still a page until the user asks for the reset — the recommendation is not retroactive.
		expect(await layoutOf(objectId)).toBe(PAGE);

		expect((await resolve()).error.code).toBe(0);

		expect(await layoutOf(objectId)).toBe(TASK);
	});

	it("leaves objects of other types alone", async () => {
		await recommend(TASK);
		const mine = await createObject("Mine");

		signInAs(owner);
		const other = await (
			await post("/api/command/ObjectCreate", {
				spaceId,
				details: { name: "Untyped" },
				internalFlags: [],
			})
		).json();

		expect((await resolve()).error.code).toBe(0);
		expect(await layoutOf(mine)).toBe(TASK);
		expect(await layoutOf(other.objectId)).toBe(PAGE);
	});

	it("refuses a reader and answers NOT_FOUND for a type that is not there", async () => {
		expect((await resolve(typeId, reader)).error).toEqual({
			code: 2,
			description: "Object access denied.",
		});

		const missing = await resolve("no-such-type-object");
		expect(missing.error.code).toBe(3);
		expect(missing.error.description).not.toBe("");
	});

	it("answers NOT_SUPPORTED for an object that is not a type", async () => {
		const notAType = await createObject("Not a type");

		expect((await resolve(notAType)).error.code).toBe(12);
	});
});
