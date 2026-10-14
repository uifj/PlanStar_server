import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API_PREFIX } from "../../src/config/constants.js";
import { prisma } from "../../src/lib/prisma.js";
import { bookingService } from "../../src/modules/bookings/service.js";
import { vanLifeService } from "../../src/modules/vanlife/service.js";
import { asAuthUser, signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import {
	clearVanLifeRows,
	createBooking,
	createRenter,
	createVanLifeHost,
	isoDate,
	vanRequestBody,
} from "./helpers/vanlife-data.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
		handler: vi.fn(),
	},
}));

const databaseAvailable = await isDatabaseAvailable();

const { del, post } = await import("./helpers/request.js");

function dateOnly(value: Date) {
	return value.toISOString().slice(0, 10);
}

describe.skipIf(!databaseAvailable)("the planner's availability check", () => {
	let host: ReturnType<typeof asAuthUser>;
	let renterId: string;
	let spaceId: string;

	async function publish(overrides: Record<string, unknown>) {
		signInAs(host.id, { role: "host" });

		const response = await post(
			`${API_PREFIX}/host/vans`,
			vanRequestBody(overrides),
		);

		expect(response.status).toBe(201);

		return ((await response.json()) as { id: string }).id;
	}

	beforeEach(async () => {
		await clearVanLifeRows();
		await prisma.user.deleteMany({
			where: { id: { startsWith: "avail." } },
		});
		host = asAuthUser(await createVanLifeHost("avail.host"));
		renterId = (await createRenter("avail.renter")).id;
		spaceId = await vanLifeService.ensureVanLifeSpace(host);
	});

	afterAll(async () => {
		await clearVanLifeRows();
		await prisma.user.deleteMany({
			where: { id: { startsWith: "avail." } },
		});
	});

	it("names the booking that blocks the dates", async () => {
		// Arrange
		const vanId = await publish({ name: "Moab Trailhouse", price: 129 });
		const held = await createBooking(renterId, vanId, {
			status: "confirmed",
			startDate: new Date(`${isoDate(30)}T00:00:00.000Z`),
			endDate: new Date(`${isoDate(33)}T00:00:00.000Z`),
		});

		// Act
		const conflict = await bookingService.findConflictingBooking(
			vanId,
			new Date(`${isoDate(31)}T00:00:00.000Z`),
			new Date(`${isoDate(35)}T00:00:00.000Z`),
		);

		// Assert
		expect(conflict).toEqual({
			startDate: dateOnly(held.startDate),
			endDate: dateOnly(held.endDate),
		});
	});

	it("says clear when the only overlap was cancelled", async () => {
		// Arrange
		const vanId = await publish({ name: "Desert Runner", price: 89 });
		await createBooking(renterId, vanId, {
			status: "cancelled",
			startDate: new Date(`${isoDate(30)}T00:00:00.000Z`),
			endDate: new Date(`${isoDate(33)}T00:00:00.000Z`),
		});

		// Act
		const conflict = await bookingService.findConflictingBooking(
			vanId,
			new Date(`${isoDate(31)}T00:00:00.000Z`),
			new Date(`${isoDate(32)}T00:00:00.000Z`),
		);

		// Assert
		expect(conflict).toBeNull();
	});

	it("offers a listed van to the planner", async () => {
		// Arrange
		const vanId = await publish({
			name: "Sierra Weekender",
			price: 89,
			location: "Mammoth Lakes, CA",
		});

		// Act
		const van = await vanLifeService.findListedVan(host, spaceId, vanId);

		// Assert
		expect(van).toMatchObject({
			id: vanId,
			name: "Sierra Weekender",
			price: 89,
			location: "Mammoth Lakes, CA",
			type: "simple",
		});
	});

	it("hides a retired van and one that never existed", async () => {
		// Arrange
		const retiredId = await publish({ name: "Retired Runner", price: 50 });
		signInAs(host.id, { role: "host" });
		await del(`${API_PREFIX}/host/vans/${retiredId}`);

		// Act
		const retired = await vanLifeService.findListedVan(
			host,
			spaceId,
			retiredId,
		);
		const unknown = await vanLifeService.findListedVan(
			host,
			spaceId,
			"none-such",
		);

		// Assert
		expect(retired).toBeUndefined();
		expect(unknown).toBeUndefined();
	});
});
