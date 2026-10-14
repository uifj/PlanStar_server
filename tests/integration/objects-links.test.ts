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

const { get, post, patch } = await import("./helpers/request.js");

type Json = Record<string, unknown>;

async function createUser(id: string) {
	return prisma.user.create({
		data: { id, name: id, email: `${id}@vanlife.test` },
	});
}

describe.skipIf(!databaseAvailable)("object relations", () => {
	let ownerId: string;
	let spaceId: string;
	let tripTypeId: string;

	beforeAll(async () => {
		const owner = await createUser("links.owner");
		ownerId = owner.id;
		signInAs(ownerId);

		const space = await post(`${API_PREFIX}/spaces`, { name: "Links bench" });
		spaceId = (await space.json()).id as string;

		await post(`${API_PREFIX}/spaces/${spaceId}/relations`, {
			uniqueKey: "related",
			format: "object",
			name: "Related",
		});
		const type = await post(`${API_PREFIX}/spaces/${spaceId}/object-types`, {
			uniqueKey: "trip",
			name: "Trip",
			relationKeys: ["related"],
		});
		tripTypeId = (await type.json()).id as string;
	});

	afterAll(async () => {
		await prisma.user.deleteMany({ where: { id: { startsWith: "links." } } });
	});

	async function createObject(name: string) {
		const response = await post(`${API_PREFIX}/spaces/${spaceId}/objects`, {
			typeId: tripTypeId,
			name,
		});

		expect(response.status).toBe(201);

		return (await response.json()).id as string;
	}

	it("keeps the linked objects in the order they were written", async () => {
		// Arrange
		const north = await createObject("North");
		const south = await createObject("South");

		// Act
		const linker = await post(`${API_PREFIX}/spaces/${spaceId}/objects`, {
			typeId: tripTypeId,
			name: "Loop",
			details: { related: [north, south] },
		});
		expect(linker.status).toBe(201);
		const created = (await linker.json()) as Json;
		const listed = await get(`${API_PREFIX}/objects/${created.id as string}`);
		const object = (await listed.json()) as Json;

		// Assert
		expect(object.details).toEqual({ related: [north, south] });
	});

	it("lists the objects that link to an object", async () => {
		// Arrange
		const north = await createObject("North linked");
		const linker = await post(`${API_PREFIX}/spaces/${spaceId}/objects`, {
			typeId: tripTypeId,
			name: "Loop two",
			details: { related: [north] },
		});
		expect(linker.status).toBe(201);
		const loop = (await linker.json()) as Json;

		// Act
		const response = await get(`${API_PREFIX}/objects/${north}/backlinks`);
		const body = (await response.json()) as Json;

		// Assert
		expect(response.status).toBe(200);
		expect(body.data).toEqual([
			expect.objectContaining({ id: loop.id, name: "Loop two" }),
		]);
	});

	it("replaces the linked set when the relation is written again", async () => {
		// Arrange
		const north = await createObject("North kept");
		const south = await createObject("South dropped");
		const east = await createObject("East added");
		const linker = await post(`${API_PREFIX}/spaces/${spaceId}/objects`, {
			typeId: tripTypeId,
			name: "Loop three",
			details: { related: [north, south] },
		});
		const loopId = (await linker.json()).id as string;

		// Act
		const patched = await patch(`${API_PREFIX}/objects/${loopId}`, {
			details: { related: [east, north] },
		});
		const cleared = await patch(`${API_PREFIX}/objects/${loopId}`, {
			details: { related: null },
		});

		// Assert — the written order is what comes back, and null clears the edges
		expect(((await patched.json()) as Json).details).toEqual({
			related: [east, north],
		});
		expect(((await cleared.json()) as Json).details).toEqual({});

		const backlinks = await get(`${API_PREFIX}/objects/${north}/backlinks`);
		expect(((await backlinks.json()) as Json).data).not.toContainEqual(
			expect.objectContaining({ id: loopId }),
		);
	});

	it("rejects a linked object the space does not contain", async () => {
		// Act
		const response = await post(`${API_PREFIX}/spaces/${spaceId}/objects`, {
			typeId: tripTypeId,
			name: "Dangling",
			details: { related: ["nonexistent-object"] },
		});
		const body = (await response.json()) as Json;

		// Assert
		expect(response.status).toBe(422);
		expect(body.message).toContain("nonexistent-object");
	});

	it("hides an unreachable object's backlinks behind not found", async () => {
		// Arrange
		const stranger = await createUser("links.stranger");
		const target = await createObject("North hidden");

		// Act — as someone outside the space
		signInAs(stranger.id);
		const response = await get(`${API_PREFIX}/objects/${target}/backlinks`);

		// Assert — ADR-0006: existence is not leaked across spaces
		expect(response.status).toBe(404);

		signInAs(ownerId);
	});
});
