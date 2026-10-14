import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/prisma.js";
import { objectService } from "../../src/modules/objects/service.js";
import { vanLifeService } from "../../src/modules/vanlife/service.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { createVanLifeHost } from "./helpers/vanlife-data.js";

const databaseAvailable = await isDatabaseAvailable();

function asAuthUser(user: {
	id: string;
	name: string;
	email: string;
	role: string | null;
}): AuthUser {
	return {
		id: user.id,
		name: user.name,
		email: user.email,
		emailVerified: true,
		image: null,
		role: user.role,
	} as AuthUser;
}

describe.skipIf(!databaseAvailable)("the generated VanLife type", () => {
	let host: AuthUser;
	let spaceId: string;

	beforeAll(async () => {
		host = asAuthUser(await createVanLifeHost("registry.host"));
		spaceId = await vanLifeService.ensureVanLifeSpace(host);
	});

	afterAll(async () => {
		await prisma.user.deleteMany({
			where: { id: { startsWith: "registry." } },
		});
	});

	it("gives the space a van type the catalog can be written into", async () => {
		// Act
		const types = await vanLifeService.ensureVanLifeTypes(host, spaceId);
		const van = await objectService.create(host, spaceId, {
			typeId: types.van,
			name: "Sierra Weekender",
			details: {
				price: 89,
				sleeps: 2,
				rating: 4.6,
				type: ["simple"],
				amenities: ["heater", "solar"],
				location: "Mammoth Lakes, CA",
			},
		});

		// Assert — choices arrive as arrays, scalars stay scalars
		expect(van.typeId).toBe(types.van);
		expect(van.details).toMatchObject({
			price: 89,
			type: ["simple"],
			amenities: ["heater", "solar"],
		});
	});

	it("generates the same registry when it runs again", async () => {
		// Act
		const first = await vanLifeService.ensureVanLifeTypes(host, spaceId);
		const again = await vanLifeService.ensureVanLifeTypes(host, spaceId);

		// Assert
		expect(again).toEqual(first);
		expect(
			await prisma.objectType.count({
				where: { spaceId, uniqueKey: { in: ["van", "booking", "review"] } },
			}),
		).toBe(3);
	});

	it("lets a booking name the van it holds", async () => {
		// Arrange
		const types = await vanLifeService.ensureVanLifeTypes(host, spaceId);
		const van = await objectService.create(host, spaceId, {
			typeId: types.van,
			name: "Alpine Cruiser",
		});

		// Act
		const booking = await objectService.create(host, spaceId, {
			typeId: types.booking,
			name: "Three nights in Aspen",
			details: {
				van: [van.id],
				startDate: "2026-11-01T00:00:00.000Z",
				guests: 2,
				status: ["pending"],
			},
		});
		const backlinks = await objectService.findBacklinks(host, van.id, {
			page: 1,
			limit: 10,
		});

		// Assert — the link is an edge in the graph, not a value in details
		expect(booking.details.van).toEqual([van.id]);
		expect(backlinks.data.map((object) => object.id)).toContain(booking.id);
	});
});
