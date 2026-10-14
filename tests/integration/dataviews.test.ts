import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { API_PREFIX } from "../../src/config/constants.js";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
		handler: vi.fn(),
	},
}));

const databaseAvailable = await isDatabaseAvailable();

const { get, post } = await import("./helpers/request.js");

type Json = Record<string, unknown>;

async function createUser(id: string) {
	return prisma.user.create({
		data: { id, name: id, email: `${id}@vanlife.test` },
	});
}

describe.skipIf(!databaseAvailable)("saved views", () => {
	let ownerId: string;
	let spaceId: string;
	let tripTypeId: string;

	beforeAll(async () => {
		const owner = await createUser("views.owner");
		ownerId = owner.id;
		signInAs(ownerId);

		const space = await post(`${API_PREFIX}/spaces`, { name: "View space" });
		spaceId = (await space.json()).id as string;

		await post(`${API_PREFIX}/spaces/${spaceId}/relations`, {
			uniqueKey: "budget",
			format: "number",
			name: "Budget",
		});
		const type = await post(`${API_PREFIX}/spaces/${spaceId}/object-types`, {
			uniqueKey: "trip",
			name: "Trip",
			relationKeys: ["budget"],
		});
		tripTypeId = (await type.json()).id as string;

		for (const [name, budget] of [
			["Iceland", 150],
			["Backyard", 80],
		]) {
			await post(`${API_PREFIX}/spaces/${spaceId}/objects`, {
				typeId: tripTypeId,
				name,
				details: { budget },
			});
		}
	});

	afterAll(async () => {
		await prisma.user.deleteMany({ where: { id: { startsWith: "views." } } });
	});

	function gridView(body: unknown = {}) {
		return post(`${API_PREFIX}/spaces/${spaceId}/dataviews`, {
			name: "Expensive trips",
			sourceTypeId: tripTypeId,
			viewType: "grid",
			...body,
		});
	}

	it("saves a grid view over a type", async () => {
		// Act
		const response = await gridView();
		const view = (await response.json()) as Json;

		// Assert
		expect(response.status).toBe(201);
		expect(view).toMatchObject({
			name: "Expensive trips",
			resolvedLayout: "dataview",
			details: {
				viewType: "grid",
				setSource: [tripTypeId],
			},
		});

		// A view is an object, so the one list serves it (ADR-0005, ADR-0012)
		const listed = await get(
			`${API_PREFIX}/spaces/${spaceId}/objects?layout=dataview`,
		);
		expect(((await listed.json()) as Json).data).toEqual([
			expect.objectContaining({ id: view.id }),
		]);
	});

	it("runs the view's filters and reports both counters", async () => {
		// Arrange
		const response = await gridView({
			filters: [{ key: "budget", operator: "greater", value: 100 }],
			sorts: [{ key: "budget", order: "asc" }],
		});
		expect(response.status).toBe(201);
		const view = (await response.json()) as Json;

		// Act
		const records = await get(
			`${API_PREFIX}/spaces/${spaceId}/dataviews/${view.id as string}/records`,
		);
		const body = (await records.json()) as Json;

		// Assert — one row matches, two exist of this type
		expect(records.status).toBe(200);
		expect((body.data as Json[]).map((row) => row.name)).toEqual(["Iceland"]);
		expect(body.counters).toEqual({ matched: 1, total: 2 });
	});

	it("refuses to save a view whose filter names an unregistered relation", async () => {
		// Act
		const response = await gridView({
			filters: [{ key: "ghost", operator: "equal", value: 1 }],
		});
		const body = (await response.json()) as Json;

		// Assert — a view that cannot compile would fail on every later read
		expect(response.status).toBe(422);
		expect(body.message).toContain("ghost");
	});

	it("refuses an unknown source type", async () => {
		// Act
		const response = await gridView({ sourceTypeId: "no-such-type" });

		// Assert
		expect(response.status).toBe(404);
	});

	it("lets a reader run a view but not save one", async () => {
		// Arrange
		const reader = await createUser("views.reader");
		const view = (await (await gridView()).json()) as Json;
		const invite = await post(`${API_PREFIX}/spaces/${spaceId}/participants`, {
			userId: reader.id,
			permission: "reader",
		});
		expect(invite.status).toBe(201);

		// Act — as the reader
		signInAs(reader.id);
		const records = await get(
			`${API_PREFIX}/spaces/${spaceId}/dataviews/${view.id as string}/records`,
		);
		const saved = await gridView();

		// Assert
		expect(records.status).toBe(200);
		expect(saved.status).toBe(403);

		signInAs(ownerId);
	});

	it("reports a view whose stored configuration cannot be read", async () => {
		// Arrange
		const response = await gridView();
		const viewId = ((await response.json()) as Json).id as string;
		await prisma.obj.update({
			where: { id: viewId },
			data: { details: { viewType: "grid", dataviewFilters: "not-an-array" } },
		});

		// Act
		const records = await get(
			`${API_PREFIX}/spaces/${spaceId}/dataviews/${viewId}/records`,
		);

		// Assert — ADR-0012's documented consequence
		expect(records.status).toBe(422);
	});
});
