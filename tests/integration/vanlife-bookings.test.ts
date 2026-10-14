import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { API_PREFIX } from "../../src/config/constants.js";
import { prisma } from "../../src/lib/prisma.js";
import { signedOut, signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import {
	clearVanLifeRows,
	createBooking,
	createRenter,
	createReview,
	createVan,
	createVanLifeHost,
	isoDate,
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

const { get, post } = await import("./helpers/request.js");

describe.skipIf(!databaseAvailable)("renter bookings", () => {
	let hostId: string;
	let renterId: string;
	let otherRenterId: string;
	let vanId: string;

	beforeAll(async () => {
		await clearVanLifeRows();
		hostId = (await createVanLifeHost("bookings.host")).id;
		renterId = (await createRenter("bookings.renter")).id;
		otherRenterId = (await createRenter("bookings.other")).id;
		vanId = (await createVan(hostId, { price: 89 })).id;
	});

	afterEach(async () => {
		await prisma.review.deleteMany();
		await prisma.booking.deleteMany();
	});

	afterAll(async () => {
		await clearVanLifeRows();
		await prisma.user.deleteMany({
			where: { id: { startsWith: "bookings." } },
		});
	});

	function bookingBody(overrides: Record<string, unknown> = {}) {
		return {
			vanId,
			startDate: isoDate(30),
			endDate: isoDate(33),
			guests: 2,
			...overrides,
		};
	}

	async function book(overrides: Record<string, unknown> = {}) {
		signInAs(renterId, { role: "user" });

		return post(`${API_PREFIX}/bookings`, bookingBody(overrides));
	}

	it("asks a signed-in caller before booking", async () => {
		// Arrange
		signedOut();

		// Act
		const response = await post(`${API_PREFIX}/bookings`, bookingBody());

		// Assert
		expect(response.status).toBe(401);
	});

	it("books a van and prices it by the night", async () => {
		// Act
		const response = await book();

		// Assert — a booking comes back bare, with no user or van echoed
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({
			id: expect.any(String),
			startDate: isoDate(30),
			endDate: isoDate(33),
			guests: 2,
			totalPrice: 267,
			status: "pending",
			createdAt: expect.any(String),
		});
	});

	it("refuses a start date already gone by", async () => {
		// Act
		const response = await book({
			startDate: isoDate(-5),
			endDate: isoDate(-2),
		});

		// Assert
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			message: "Start date must be today or later.",
		});
	});

	it("refuses an end date that is not after the start", async () => {
		// Act
		const response = await book({
			startDate: isoDate(30),
			endDate: isoDate(30),
		});

		// Assert
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			message: "End date must be after start date.",
		});
	});

	it("refuses more guests than the van sleeps", async () => {
		// Act
		const response = await book({ guests: 3 });

		// Assert
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			message: "Guests cannot exceed van capacity.",
		});
	});

	it("refuses a van that is not on the books", async () => {
		// Act
		const response = await book({ vanId: "none-such" });

		// Assert
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ message: "Van not found." });
	});

	it("refuses dates that overlap a booking already held", async () => {
		// Arrange
		expect(
			(await book({ startDate: isoDate(40), endDate: isoDate(43) })).status,
		).toBe(201);

		// Act — a second renter reaches into the same window
		signInAs(otherRenterId, { role: "user" });
		const response = await post(
			`${API_PREFIX}/bookings`,
			bookingBody({ startDate: isoDate(42), endDate: isoDate(45) }),
		);

		// Assert
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			message: "Requested dates overlap an existing booking.",
		});
	});

	it("refuses a host that has no renter account", async () => {
		// Arrange
		signInAs(hostId, { role: "host" });

		// Act
		const response = await post(`${API_PREFIX}/bookings`, bookingBody());

		// Assert
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			message: "You need a renter account to do this.",
		});
	});

	it("lists only the caller's bookings, with the van and any review attached", async () => {
		// Arrange
		const mine = await createBooking(renterId, vanId, {
			startDate: new Date(`${isoDate(10)}T00:00:00.000Z`),
			endDate: new Date(`${isoDate(11)}T00:00:00.000Z`),
			status: "completed",
			totalPrice: 89,
		});
		await createBooking(otherRenterId, vanId, {
			startDate: new Date(`${isoDate(12)}T00:00:00.000Z`),
			endDate: new Date(`${isoDate(13)}T00:00:00.000Z`),
		});
		const review = await createReview(renterId, vanId, mine.id, { rating: 4 });

		signInAs(renterId, { role: "user" });

		// Act
		const response = await get(
			`${API_PREFIX}/bookings?sort=startDate&order=asc`,
		);

		// Assert
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: [
				{
					id: mine.id,
					startDate: isoDate(10),
					endDate: isoDate(11),
					guests: 1,
					totalPrice: 89,
					status: "completed",
					createdAt: mine.createdAt.toISOString(),
					review: {
						id: review.id,
						rating: 4,
						text: "Loved the quiet.",
						createdAt: review.createdAt.toISOString(),
					},
					van: {
						id: vanId,
						name: "Sierra Weekender",
						imageUrl: "https://images.example.test/sierra-weekender.jpg",
						type: "simple",
						location: "Mammoth Lakes, CA",
					},
				},
			],
			meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
		});
	});

	it("filters the list down to one status", async () => {
		// Arrange
		await createBooking(renterId, vanId, { status: "pending" });
		await createBooking(renterId, vanId, {
			startDate: new Date(`${isoDate(60)}T00:00:00.000Z`),
			endDate: new Date(`${isoDate(61)}T00:00:00.000Z`),
			status: "cancelled",
		});
		signInAs(renterId, { role: "user" });

		// Act
		const response = await get(`${API_PREFIX}/bookings?status=cancelled`);

		// Assert
		expect(((await response.json()) as { data: unknown[] }).data).toHaveLength(
			1,
		);
	});

	it("cancels a booking the caller still holds", async () => {
		// Arrange
		const created = (await book()) as Response;
		const booking = (await created.json()) as { id: string };

		// Act
		const response = await post(
			`${API_PREFIX}/bookings/${booking.id}/cancel`,
			{},
		);

		// Assert
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			id: booking.id,
			startDate: isoDate(30),
			endDate: isoDate(33),
			guests: 2,
			totalPrice: 267,
			status: "cancelled",
			createdAt: expect.any(String),
		});
	});

	it("refuses to cancel a trip that is already over", async () => {
		// Arrange
		const booking = await createBooking(renterId, vanId, {
			status: "completed",
		});
		signInAs(renterId, { role: "user" });

		// Act
		const response = await post(
			`${API_PREFIX}/bookings/${booking.id}/cancel`,
			{},
		);

		// Assert
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			message: "Booking cannot be cancelled.",
		});
	});

	it("does not confirm another renter's booking id", async () => {
		// Arrange
		const theirs = await createBooking(otherRenterId, vanId);
		signInAs(renterId, { role: "user" });

		// Act
		const response = await post(
			`${API_PREFIX}/bookings/${theirs.id}/cancel`,
			{},
		);

		// Assert — ownership leaks as a 404, not a 403
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ message: "Booking not found." });
	});
});
