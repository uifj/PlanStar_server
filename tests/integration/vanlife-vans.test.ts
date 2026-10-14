import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_PREFIX } from "../../src/config/constants.js";
import { prisma } from "../../src/lib/prisma.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import {
	clearVanLifeRows,
	createVan,
	createVanLifeHost,
} from "./helpers/vanlife-data.js";

const databaseAvailable = await isDatabaseAvailable();

const { get } = await import("./helpers/request.js");

type Json = Record<string, unknown>;

describe.skipIf(!databaseAvailable)("public van routes", () => {
	let oldest: Json;
	let middle: Json;
	let newest: Json;
	let retired: Json;

	beforeAll(async () => {
		await clearVanLifeRows();
		const hostId = (await createVanLifeHost("vans.host")).id;

		oldest = (await createVan(hostId, {
			name: "Oldest",
			price: 150,
			location: "Moab, UT",
			createdAt: new Date("2026-06-01"),
		})) as unknown as Json;
		middle = (await createVan(hostId, {
			name: "Middle",
			price: 72,
			type: "rugged",
			location: "Big Sur, CA",
			createdAt: new Date("2026-07-01"),
		})) as unknown as Json;
		newest = (await createVan(hostId, {
			name: "Newest",
			price: 118,
			type: "luxury",
			location: "Aspen, CO",
			createdAt: new Date("2026-08-01"),
		})) as unknown as Json;
		retired = (await createVan(hostId, {
			name: "Retired",
			location: "Portland, OR",
			archivedAt: new Date("2026-08-20"),
		})) as unknown as Json;
	});

	afterAll(async () => {
		await clearVanLifeRows();
		await prisma.user.deleteMany({ where: { id: { startsWith: "vans." } } });
	});

	function summary(van: Json) {
		return {
			id: van.id,
			name: van.name,
			price: van.price,
			imageUrl: van.imageUrl,
			type: van.type,
			location: van.location,
			sleeps: van.sleeps,
			rating: van.rating,
		};
	}

	async function list(query = "") {
		const response = await get(`${API_PREFIX}/vans?${query}`);

		return (await response.json()) as Json;
	}

	it("lets an anonymous caller browse the catalog", async () => {
		// Act
		const response = await get(`${API_PREFIX}/vans`);

		// Assert — the catalog has never required a session
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: [summary(newest), summary(middle), summary(oldest)],
			meta: { page: 1, limit: 10, total: 3, totalPages: 1 },
		});
	});

	it("orders by another column when the client asks for it", async () => {
		// Act
		const body = await list("sort=price&order=asc");

		// Assert
		expect(body.data).toEqual([
			summary(middle),
			summary(newest),
			summary(oldest),
		]);
	});

	it("narrows the list to one van type", async () => {
		// Act
		const body = await list("type=rugged");

		// Assert
		expect(body.data).toEqual([summary(middle)]);
		expect(body.meta).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
	});

	it("searches name, location and description without minding case", async () => {
		// Act
		const byLocation = await list("search=MOAB");
		const byDescription = await list("search=explorer");

		// Assert
		expect(byLocation.data).toEqual([summary(oldest)]);
		expect(byDescription.data).toHaveLength(3);
	});

	it("pages through the list one van at a time", async () => {
		// Act
		const body = await list("limit=1&page=2");

		// Assert
		expect(body.data).toEqual([summary(middle)]);
		expect(body.meta).toEqual({ page: 2, limit: 1, total: 3, totalPages: 3 });
	});

	it("reads one van whole without an envelope", async () => {
		// Act
		const response = await get(`${API_PREFIX}/vans/${newest.id}`);

		// Assert
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			...summary(newest),
			description: newest.description,
			amenities: newest.amenities,
		});
	});

	it("hides an archived van from the list and its own detail page", async () => {
		// Act
		const body = await list();
		const detail = await get(`${API_PREFIX}/vans/${retired.id}`);

		// Assert
		expect(body.data).not.toContainEqual(summary(retired));
		expect(detail.status).toBe(404);
		expect(await detail.json()).toEqual({ message: "Van not found." });
	});

	it("answers an unknown van id with not found", async () => {
		// Act
		const response = await get(`${API_PREFIX}/vans/none-such`);

		// Assert
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ message: "Van not found." });
	});
});
