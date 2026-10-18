import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The settings "Object Types" / "Properties" rail (component/sidebar/page/settings/library.tsx)
// subscribes with the bare `library` subId and filters the space's registries by resolvedLayout.
// Its records are registry rows, not object rows — the type/relation mirror rows are hidden from the
// object lists — so the general object-list branch cannot serve it and the rail renders empty.
describe.skipIf(!databaseAvailable)("library subscription", () => {
	const owner = "library.owner";

	beforeAll(async () => {
		await prisma.user.create({
			data: {
				id: owner,
				name: "Library owner",
				email: "library-owner@vanlife.test",
			},
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: owner } });
		await prisma.user.delete({ where: { id: owner } });
	});

	const createSpace = async () => {
		signInAs(owner);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Library space" },
				useCase: 2,
			})
		).json();
		return spaceId as string;
	};

	const createType = async (spaceId: string, name: string) => {
		signInAs(owner);
		const { details } = await (
			await post("/api/command/ObjectCreateObjectType", {
				spaceId,
				details: { name },
				internalFlags: [],
			})
		).json();
		return { id: details.id as string, uniqueKey: details.uniqueKey as string };
	};

	const createRelation = async (spaceId: string, name: string) => {
		signInAs(owner);
		// I.RelationType.ShortText === 1.
		const body = await (
			await post("/api/command/ObjectCreateRelation", {
				spaceId,
				details: { name, relationFormat: 1 },
			})
		).json();
		return { id: body.objectId as string };
	};

	// Anytype's FilterCondition numbers (front_web interface/block/dataview.ts): Equal 1, NotIn 10,
	// In 9. `format` rides the wire from the client's relation lookup and selects the text compare.
	const subscribe = async (
		spaceId: string,
		filters: unknown[],
		sorts: unknown[] = [],
	) => {
		signInAs(owner);
		return (
			await post("/api/command/ObjectSearchSubscribe", {
				spaceId,
				subId: "library",
				filters,
				sorts,
				keys: ["id", "name", "uniqueKey", "resolvedLayout", "restrictions"],
			})
		).json();
	};

	const typeFilters = () => [
		{ RelationKey: "resolvedLayout", format: 3, condition: 1, value: 4 },
		{ RelationKey: "uniqueKey", format: 1, condition: 10, value: ["ot-type"] },
	];

	const relationFilters = () => [
		{ RelationKey: "resolvedLayout", format: 3, condition: 1, value: 5 },
	];

	it("lists the space's types for the type rail", async () => {
		const spaceId = await createSpace();
		const custom = await createType(spaceId, "Trailhead");

		const body = await subscribe(spaceId, typeFilters());

		expect(body.error).toEqual({ code: 0, description: "" });
		const ids = (body.records as any[]).map((it) => it.id);
		expect(ids).toContain(custom.id);
		expect((body.records as any[]).every((it) => it.resolvedLayout === 4)).toBe(
			true,
		);
		// The rail decides its two sections with S.Block.isAllowed(it.restrictions, ...), which
		// calls restrictions.indexOf — a list, never an object.
		expect(
			(body.records as any[]).every((it) => Array.isArray(it.restrictions)),
		).toBe(true);
	});

	it("lists the space's relations for the property rail", async () => {
		const spaceId = await createSpace();
		const custom = await createRelation(spaceId, "Surface");

		const body = await subscribe(spaceId, relationFilters());

		const ids = (body.records as any[]).map((it) => it.id);
		expect(ids).toContain(custom.id);
		expect((body.records as any[]).every((it) => it.resolvedLayout === 5)).toBe(
			true,
		);
	});

	it("narrows to the ids the rail's search names", async () => {
		const spaceId = await createSpace();
		await createType(spaceId, "First");
		const second = await createType(spaceId, "Second");

		const body = await subscribe(spaceId, [
			...typeFilters(),
			{ RelationKey: "id", format: 0, condition: 9, value: [second.id] },
		]);

		expect((body.records as any[]).map((it) => it.id)).toEqual([second.id]);
	});
});
