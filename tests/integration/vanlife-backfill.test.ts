import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/prisma.js";
import { objectService } from "../../src/modules/objects/service.js";
import { vanLifeService } from "../../src/modules/vanlife/service.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import {
	clearVanLifeRows,
	createBooking,
	createRenter,
	createReview,
	createVan,
	createVanLifeHost,
} from "./helpers/vanlife-data.js";

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

describe.skipIf(!databaseAvailable)("backfilling VanLife into objects", () => {
	let host: AuthUser;
	let renter: AuthUser;
	let spaceId: string;
	let vanTypeId: string;

	beforeAll(async () => {
		await clearVanLifeRows();
		host = asAuthUser(await createVanLifeHost("backfill.host"));
		renter = asAuthUser(await createRenter("backfill.renter"));
		spaceId = await vanLifeService.ensureVanLifeSpace(host);
		vanTypeId = (await vanLifeService.ensureVanLifeTypes(host, spaceId)).van;
	});

	afterAll(async () => {
		await clearVanLifeRows();
		await prisma.user.deleteMany({
			where: { id: { startsWith: "backfill." } },
		});
	});

	it("copies a published van under its own id", async () => {
		// Arrange
		const van = await createVan(host.id, {
			name: "Sierra Weekender",
			price: 89,
			sleeps: 2,
			amenities: ["heater", "solar"],
		});

		// Act
		await vanLifeService.backfillVanLife(host, spaceId);
		const object = await objectService.findById(host, van.id);

		// Assert
		expect(object.id).toBe(van.id);
		expect(object.spaceId).toBe(spaceId);
		expect(object.typeId).toBe(vanTypeId);
		expect(object.name).toBe("Sierra Weekender");
		expect(object.details).toMatchObject({
			price: 89,
			sleeps: 2,
			type: ["simple"],
			amenities: ["heater", "solar"],
		});
	});

	it("carries a retired van so the catalog can filter it out", async () => {
		// Arrange
		const retired = await createVan(host.id, {
			name: "Retired",
			archivedAt: new Date("2026-08-20"),
		});

		// Act
		await vanLifeService.backfillVanLife(host, spaceId);
		const live = await objectService.list(host, spaceId, {
			filters: [{ key: "isArchived", operator: "equal", value: false }],
			sorts: [],
			layouts: [],
			page: 1,
			limit: 50,
		});

		// Assert — the kernel lists every live object; the catalog chooses the filter
		expect(live.data.map((object) => object.id)).not.toContain(retired.id);
		expect((await objectService.findById(host, retired.id)).isArchived).toBe(
			true,
		);
	});

	it("copies bookings and reviews as linked objects", async () => {
		// Arrange
		const van = await createVan(host.id, { name: "Alpine Cruiser" });
		const booking = await createBooking(renter.id, van.id, {
			status: "completed",
			totalPrice: 356,
		});
		const review = await createReview(renter.id, van.id, booking.id, {
			rating: 5,
			text: "Warm nights.",
		});

		// Act
		await vanLifeService.backfillVanLife(host, spaceId);
		const copiedBooking = await objectService.findById(host, booking.id);
		const backlinks = await objectService.findBacklinks(host, van.id, {
			page: 1,
			limit: 10,
		});

		// Assert — the van reference reads back as a value but is stored as an edge
		expect(copiedBooking.details).toMatchObject({
			totalPrice: 356,
			guests: 1,
			status: ["completed"],
			van: [van.id],
		});
		expect(
			await prisma.link.count({
				where: { fromId: booking.id, relationKey: "van" },
			}),
		).toBe(1);
		expect(backlinks.data.map((object) => object.id)).toEqual(
			expect.arrayContaining([booking.id, review.id]),
		);
	});

	it("copies one object per legacy row and follows later edits", async () => {
		// Arrange
		const van = await createVan(host.id, { name: "Before", price: 100 });

		// Act
		await vanLifeService.backfillVanLife(host, spaceId);
		await prisma.van.update({
			where: { id: van.id },
			data: { name: "After", price: 150 },
		});
		const second = await vanLifeService.backfillVanLife(host, spaceId);

		// Assert
		const object = await objectService.findById(host, van.id);
		expect(object.name).toBe("After");
		expect(object.details).toMatchObject({ price: 150 });

		const [vanRows, copiedVans] = await Promise.all([
			prisma.van.count(),
			prisma.obj.count({ where: { spaceId, typeId: vanTypeId } }),
		]);

		expect(copiedVans).toBe(vanRows);
		expect(second.vans).toBe(vanRows);
	});
});
