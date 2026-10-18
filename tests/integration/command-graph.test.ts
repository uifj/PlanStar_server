import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// P4 graph: ObjectGraph(spaceId, ...) feeds the graph view. U.Data.getGraphData reads
// message.nodes (detail records, kept when they carry a type) and message.edges
// ({ source, target }, kept when both ends are nodes). Nodes come from live Obj rows; edges come
// from both stores an object relation can live in — the Link table (what a body link projects to)
// and the object's details JSONB (where the command write path puts it, ADR-0002).
describe.skipIf(!databaseAvailable)("POST /api/command/ObjectGraph", () => {
	const ownerId = "command-graph.owner";
	const outsiderId = "command-graph.outsider";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: ownerId,
					name: "Graph owner",
					email: "command-graph-owner@vanlife.test",
				},
				{
					id: outsiderId,
					name: "Graph outsider",
					email: "command-graph-outsider@vanlife.test",
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
				details: { name: "Graph space" },
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

	const graph = async (spaceId: string, as = ownerId) => {
		signInAs(as);
		const body = await (
			await post("/api/command/ObjectGraph", {
				spaceId,
				filters: [],
				limit: 0,
				objectTypeFilter: [],
				keys: [],
				collectionId: "",
				setSource: [],
				includeTypeEdges: true,
			})
		).json();
		return body;
	};

	it("returns linked objects as nodes and their relation as an edge", async () => {
		const spaceId = await createSpace();
		const fromId = await createObject(spaceId, "Trip plan");
		const toId = await createObject(spaceId, "Campsite");

		await prisma.link.create({
			data: {
				spaceId,
				fromId,
				toId,
				relationKey: "destination",
				sortOrder: "0001",
			},
		});

		const body = await graph(spaceId);
		expect(body.error).toEqual({ code: 0, description: "" });

		const nodeIds = body.nodes.map((it: any) => it.id);
		expect(nodeIds).toContain(fromId);
		expect(nodeIds).toContain(toId);

		expect(body.edges).toContainEqual({ source: fromId, target: toId });
	});

	it("omits edges whose endpoints are not live nodes", async () => {
		const spaceId = await createSpace();
		const keptId = await createObject(spaceId, "Kept page");
		const deletedId = await createObject(spaceId, "Deleted page");

		await prisma.link.create({
			data: {
				spaceId,
				fromId: keptId,
				toId: deletedId,
				relationKey: "references",
				sortOrder: "0001",
			},
		});

		signInAs(ownerId);
		await post("/api/command/ObjectListDelete", { objectIds: [deletedId] });

		const body = await graph(spaceId);
		const nodeIds = body.nodes.map((it: any) => it.id);
		expect(nodeIds).toContain(keptId);
		expect(nodeIds).not.toContain(deletedId);
		expect(body.edges).not.toContainEqual({
			source: keptId,
			target: deletedId,
		});
	});

	it("denies a caller who cannot read the space", async () => {
		const spaceId = await createSpace();
		await createObject(spaceId, "Hidden page");

		const body = await graph(spaceId, outsiderId);
		expect(body.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
	});

	// The client's own write path — the property editor, ObjectListSetDetails — stores an
	// object-valued relation in the object's details JSONB, not in Link. A graph that reads only
	// Link therefore drew 29 nodes and no edges against the live space.
	it("draws an edge for a relation set through the command path", async () => {
		const spaceId = await createSpace();
		const fromId = await createObject(spaceId, "Road trip");
		const toId = await createObject(spaceId, "Aurland");

		signInAs(ownerId);
		const relation = await (
			await post("/api/command/ObjectCreateRelation", {
				spaceId,
				// I.RelationType.Object === 100.
				details: { name: "Stopover", relationFormat: 100 },
			})
		).json();
		const key = relation.key as string;

		signInAs(ownerId);
		const set = await (
			await post("/api/command/ObjectListSetDetails", {
				objectIds: [fromId],
				details: [{ id: fromId, details: { [key]: [toId] } }],
			})
		).json();
		expect(set.error).toEqual({ code: 0, description: "" });

		const body = await graph(spaceId);
		expect(body.edges).toContainEqual({ source: fromId, target: toId });
	});
});
