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

const { del, get, patch, post } = await import("./helpers/request.js");

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
		await post(`${API_PREFIX}/spaces/${spaceId}/relations`, {
			uniqueKey: "kind",
			format: "select",
			name: "Kind",
		});
		await post(`${API_PREFIX}/spaces/${spaceId}/relations`, {
			uniqueKey: "start",
			format: "date",
			name: "Start",
		});
		const type = await post(`${API_PREFIX}/spaces/${spaceId}/object-types`, {
			uniqueKey: "trip",
			name: "Trip",
			relationKeys: ["budget", "kind", "start"],
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

	it("saves which layout the view uses", async () => {
		// Act — the layout menu offers four renderings
		const response = await gridView({ viewType: "board" });
		const view = (await response.json()) as Json;

		// Assert — the layout travels with the view, not with the caller's URL
		expect(response.status).toBe(201);
		expect((view.details as Json).viewType).toBe("board");
	});

	it("moves a saved view to another layout", async () => {
		// Arrange
		const response = await gridView();
		const viewId = ((await response.json()) as Json).id as string;

		// Act
		const patched = await patch(
			`${API_PREFIX}/spaces/${spaceId}/dataviews/${viewId}`,
			{ viewType: "gallery" },
		);
		const view = (await patched.json()) as Json;

		// Assert
		expect(patched.status).toBe(200);
		expect((view.details as Json).viewType).toBe("gallery");
	});

	it("stores the relations a layout reads", async () => {
		// Arrange
		const response = await gridView();
		const viewId = ((await response.json()) as Json).id as string;

		// Act
		const patched = await patch(
			`${API_PREFIX}/spaces/${spaceId}/dataviews/${viewId}`,
			{
				viewType: "board",
				groupRelationKey: "kind",
				coverRelationKey: "start",
			},
		);
		const details = ((await patched.json()) as Json).details as Json;

		// Assert
		expect(patched.status).toBe(200);
		expect(details).toMatchObject({
			viewType: "board",
			groupRelationKey: "kind",
			coverRelationKey: "start",
		});
	});

	it("refuses a board grouped by a relation it cannot bucket", async () => {
		// Arrange
		const response = await gridView();
		const viewId = ((await response.json()) as Json).id as string;

		// Act — budget is a number, and a board column needs a choice
		const patched = await patch(
			`${API_PREFIX}/spaces/${spaceId}/dataviews/${viewId}`,
			{ viewType: "board", groupRelationKey: "budget" },
		);

		// Assert
		expect(patched.status).toBe(422);
	});

	it("refuses a cover relation the view's type does not carry", async () => {
		// Arrange
		const response = await gridView();
		const viewId = ((await response.json()) as Json).id as string;

		// Act
		const patched = await patch(
			`${API_PREFIX}/spaces/${spaceId}/dataviews/${viewId}`,
			{ coverRelationKey: "ghost" },
		);

		// Assert
		expect(patched.status).toBe(422);
	});

	it("keeps a reader from changing a view's layout", async () => {
		// Arrange
		const reader = await createUser("views.layout.reader");
		const response = await gridView();
		const viewId = ((await response.json()) as Json).id as string;

		await post(`${API_PREFIX}/spaces/${spaceId}/participants`, {
			userId: reader.id,
			permission: "reader",
		});

		// Act
		signInAs(reader.id);
		const patched = await patch(
			`${API_PREFIX}/spaces/${spaceId}/dataviews/${viewId}`,
			{ viewType: "calendar" },
		);

		// Assert
		expect(patched.status).toBe(403);

		signInAs(ownerId);
	});

	it("refuses a layout this build cannot render", async () => {
		// Act
		const response = await gridView({ viewType: "graph" });

		// Assert
		expect(response.status).toBe(400);
	});

	it("saves a layout and its relations together with the view", async () => {
		// Act — the page is showing a grouped board when the view is saved
		const response = await gridView({
			viewType: "board",
			groupRelationKey: "kind",
		});
		const details = ((await response.json()) as Json).details as Json;

		// Assert — nothing is lost by saving first and configuring afterwards
		expect(response.status).toBe(201);
		expect(details).toMatchObject({
			viewType: "board",
			groupRelationKey: "kind",
		});
	});

	it("leaves archived objects out of a view's records", async () => {
		// Arrange
		const response = await gridView();
		const viewId = ((await response.json()) as Json).id as string;
		const scrapped = await post(`${API_PREFIX}/spaces/${spaceId}/objects`, {
			typeId: tripTypeId,
			name: "Scrapped trip",
			details: { budget: 10 },
		});
		const scrapId = ((await scrapped.json()) as Json).id as string;

		await del(`${API_PREFIX}/objects/${scrapId}`);

		// Act
		const records = await get(
			`${API_PREFIX}/spaces/${spaceId}/dataviews/${viewId}/records`,
		);
		const body = (await records.json()) as Json;

		// Assert — an archived row is out of circulation, filtered or not
		expect((body.data as Json[]).map((row) => row.name)).not.toContain(
			"Scrapped trip",
		);
		expect(body.counters).toEqual({ matched: 2, total: 2 });
	});

	it("keeps a grouping key that the new layout cannot use", async () => {
		// Arrange — a board grouped by a choice relation
		const response = await gridView();
		const viewId = ((await response.json()) as Json).id as string;
		const grouped = await patch(
			`${API_PREFIX}/spaces/${spaceId}/dataviews/${viewId}`,
			{ viewType: "board", groupRelationKey: "kind" },
		);

		expect(grouped.status).toBe(200);

		// Act — the same view is shown as a gallery, which groups by nothing
		const moved = await patch(
			`${API_PREFIX}/spaces/${spaceId}/dataviews/${viewId}`,
			{ viewType: "gallery" },
		);
		const details = ((await moved.json()) as Json).details as Json;

		// Assert — switching is never refused over a key the new layout ignores,
		// and going back to a board still has the grouping
		expect(moved.status).toBe(200);
		expect(details).toMatchObject({
			viewType: "gallery",
			groupRelationKey: "kind",
		});
	});

	it("drops a grouping key the new layout cannot bucket", async () => {
		// Arrange — a board grouped by a choice relation
		const response = await gridView();
		const viewId = ((await response.json()) as Json).id as string;

		await patch(`${API_PREFIX}/spaces/${spaceId}/dataviews/${viewId}`, {
			viewType: "board",
			groupRelationKey: "kind",
		});

		// Act — a calendar needs a date, so the choice key cannot carry over
		const moved = await patch(
			`${API_PREFIX}/spaces/${spaceId}/dataviews/${viewId}`,
			{ viewType: "calendar" },
		);
		const details = ((await moved.json()) as Json).details as Json;

		// Assert — the switch succeeds and the unusable key goes, as the customer
		// would otherwise meet a 422 for asking for a calendar
		expect(moved.status).toBe(200);
		expect(details.viewType).toBe("calendar");
		expect(details.groupRelationKey).toBeUndefined();
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
