import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { API_PREFIX } from "../../src/config/constants.js";
import { prisma } from "../../src/lib/prisma.js";
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

const { auth } = await import("../../src/lib/auth.js");
const { get, post } = await import("./helpers/request.js");

function signInAs(userId: string) {
	vi.mocked(auth.api.getSession).mockResolvedValue({
		session: {
			id: `session-${userId}`,
			userId,
			token: `token-${userId}`,
			expiresAt: new Date("2099-01-01"),
			createdAt: new Date("2026-01-01"),
			updatedAt: new Date("2026-01-01"),
			ipAddress: null,
			userAgent: null,
		},
		user: {
			id: userId,
			name: userId,
			email: `${userId}@vanlife.test`,
			emailVerified: false,
			image: null,
			createdAt: new Date("2026-01-01"),
			updatedAt: new Date("2026-01-01"),
			banned: false,
			role: null,
		},
	} as never);
}

async function createUser(id: string) {
	return prisma.user.create({
		data: {
			id,
			name: id,
			email: `${id}@vanlife.test`,
		},
	});
}

type Json = Record<string, unknown>;

function encodeFilters(filters: unknown) {
	return encodeURIComponent(JSON.stringify(filters));
}

describe.skipIf(!databaseAvailable)("object core slice", () => {
	let ownerId: string;
	let spaceId: string;

	beforeAll(async () => {
		const owner = await createUser("slice.owner");
		ownerId = owner.id;
		spaceId = "";
	});

	afterAll(async () => {
		await prisma.user.deleteMany({ where: { id: { startsWith: "slice." } } });
	});

	async function createNumberFilteredCollection() {
		// Arrange — a space the caller owns, one type, two objects
		const space = await post(`${API_PREFIX}/spaces`, { name: "Trip notes" });
		expect(space.status).toBe(201);
		spaceId = (await space.json()).id as string;

		const budget = await post(`${API_PREFIX}/spaces/${spaceId}/relations`, {
			uniqueKey: "budget",
			format: "number",
			name: "Budget",
		});
		expect(budget.status).toBe(201);

		const notes = await post(`${API_PREFIX}/spaces/${spaceId}/relations`, {
			uniqueKey: "notes",
			format: "shortText",
			name: "Notes",
		});
		expect(notes.status).toBe(201);

		const tripType = await post(
			`${API_PREFIX}/spaces/${spaceId}/object-types`,
			{
				uniqueKey: "trip",
				name: "Trip",
				iconEmoji: "🚐",
				relationKeys: ["budget", "notes"],
			},
		);
		expect(tripType.status).toBe(201);
		const typeId = (await tripType.json()).id as string;

		const expensive = await post(`${API_PREFIX}/spaces/${spaceId}/objects`, {
			typeId,
			name: "Iceland",
			details: { budget: 150, notes: "cold" },
		});
		expect(expensive.status).toBe(201);

		const cheap = await post(`${API_PREFIX}/spaces/${spaceId}/objects`, {
			typeId,
			name: "Backyard",
			details: { budget: 80, notes: "warm" },
		});
		expect(cheap.status).toBe(201);

		return { typeId };
	}

	it("refuses to list objects without a session", async () => {
		// Act
		const response = await get(`${API_PREFIX}/spaces/whatever/objects`);

		// Assert
		expect(response.status).toBe(401);
	});

	it("lists only the objects whose number relation passes the filter", async () => {
		// Arrange
		signInAs(ownerId);
		await createNumberFilteredCollection();

		// Act
		const response = await get(
			`${API_PREFIX}/spaces/${spaceId}/objects?filters=${encodeFilters([
				{ key: "budget", operator: "greater", value: 100 },
			])}`,
		);
		const body = (await response.json()) as Json;

		// Assert
		expect(response.status).toBe(200);
		expect(body.data).toHaveLength(1);
		expect((body.meta as Json).total).toBe(1);
		expect(body.data).toEqual([
			expect.objectContaining({
				name: "Iceland",
				details: { budget: 150, notes: "cold" },
			}),
		]);
	});

	it("rejects a filter on a relation the space has not registered", async () => {
		// Arrange
		signInAs(ownerId);

		// Act
		const response = await get(
			`${API_PREFIX}/spaces/${spaceId}/objects?filters=${encodeFilters([
				{ key: "ghost", operator: "equal", value: 1 },
			])}`,
		);

		// Assert
		expect(response.status).toBe(422);
		expect(((await response.json()) as Json).message).toContain("ghost");
	});

	it("refuses a stranger who asks for the space's objects", async () => {
		// Arrange
		const stranger = await createUser("slice.stranger");
		signInAs(stranger.id);

		// Act
		const response = await get(`${API_PREFIX}/spaces/${spaceId}/objects`);

		// Assert
		expect(response.status).toBe(403);
	});

	it("grants a reader access but not the right to create objects", async () => {
		// Arrange
		const reader = await createUser("slice.reader");
		signInAs(ownerId);

		const invite = await post(`${API_PREFIX}/spaces/${spaceId}/participants`, {
			userId: reader.id,
			permission: "reader",
		});

		// Assert
		expect(invite.status).toBe(201);

		// Act — as the new reader
		signInAs(reader.id);
		const listed = await get(`${API_PREFIX}/spaces/${spaceId}/objects`);
		const created = await post(`${API_PREFIX}/spaces/${spaceId}/objects`, {
			name: "Not allowed",
		});

		// Assert
		expect(listed.status).toBe(200);
		expect(created.status).toBe(403);
	});

	it("mirrors a created type as an object so one list serves both", async () => {
		// Arrange
		signInAs(ownerId);

		// Act
		const response = await get(
			`${API_PREFIX}/spaces/${spaceId}/objects?layout=objectType`,
		);
		const body = (await response.json()) as Json;

		// Assert
		expect(response.status).toBe(200);
		expect(body.data).toEqual([
			expect.objectContaining({
				name: "Trip",
				resolvedLayout: "objectType",
			}),
		]);
	});
});
