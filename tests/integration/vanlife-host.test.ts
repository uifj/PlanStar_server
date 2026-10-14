import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
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

const { del, get, patch, post } = await import("./helpers/request.js");

type Json = Record<string, unknown>;

describe.skipIf(!databaseAvailable)("host desk", () => {
	let firstHostId: string;
	let secondHostId: string;
	let renterId: string;

	async function seed() {
		await clearVanLifeRows();
		await prisma.user.deleteMany({ where: { id: { startsWith: "host." } } });

		const first = await createVanLifeHost("host.one");
		const second = await createVanLifeHost("host.two");
		const renter = await createRenter("host.renter");

		firstHostId = first.id;
		secondHostId = second.id;
		renterId = renter.id;

		return { first, second, renter };
	}

	beforeAll(async () => {
		await seed();
	});

	afterAll(async () => {
		await clearVanLifeRows();
		await prisma.user.deleteMany({ where: { id: { startsWith: "host." } } });
	});

	function vanBody(overrides: Record<string, unknown> = {}) {
		return {
			name: "Alpine Cruiser",
			price: 175,
			description: "A luxury cruiser for four.",
			imageUrl: "https://images.example.test/alpine.jpg",
			type: "luxury",
			location: "Aspen, CO",
			sleeps: 4,
			amenities: ["heater", "solar"],
			...overrides,
		};
	}

	function fullVan(van: Json) {
		return {
			id: van.id,
			name: van.name,
			price: van.price,
			imageUrl: van.imageUrl,
			type: van.type,
			location: van.location,
			sleeps: van.sleeps,
			rating: van.rating,
			description: van.description,
			amenities: van.amenities,
		};
	}

	function summaryOf(van: Json) {
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

	describe("van listing and editing", () => {
		let mine: Json;
		let theirs: Json;

		beforeEach(async () => {
			await seed();
			mine = (await createVan(firstHostId, {
				name: "Sierra Weekender",
				createdAt: new Date("2026-07-01"),
			})) as unknown as Json;
			theirs = (await createVan(secondHostId, {
				name: "Other Cruiser",
			})) as unknown as Json;
		});

		it("asks a signed-in caller before opening the desk", async () => {
			// Arrange
			signedOut();

			// Act
			const response = await get(`${API_PREFIX}/host/vans`);

			// Assert
			expect(response.status).toBe(401);
		});

		it("refuses a renter at the host desk", async () => {
			// Arrange
			signInAs(renterId, { role: "user" });

			// Act
			const response = await get(`${API_PREFIX}/host/vans`);

			// Assert
			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({
				message: "You need a host account to access this.",
			});
		});

		it("lists only the caller's vans and sends no page meta", async () => {
			// Arrange
			await createVan(firstHostId, {
				name: "Retired",
				archivedAt: new Date("2026-08-01"),
			});
			signInAs(firstHostId, { role: "host" });

			// Act
			const response = await get(`${API_PREFIX}/host/vans`);

			// Assert — this route has never had a meta block
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ data: [summaryOf(mine)] });
		});

		it("creates a van for the caller and answers with the whole record", async () => {
			// Arrange
			signInAs(firstHostId, { role: "host" });

			// Act
			const response = await post(`${API_PREFIX}/host/vans`, vanBody());

			// Assert
			expect(response.status).toBe(201);
			expect(await response.json()).toEqual({
				id: expect.any(String),
				name: "Alpine Cruiser",
				price: 175,
				imageUrl: "https://images.example.test/alpine.jpg",
				type: "luxury",
				location: "Aspen, CO",
				sleeps: 4,
				rating: 0,
				description: "A luxury cruiser for four.",
				amenities: ["heater", "solar"],
			});
		});

		it("edits a van and reads it back in full", async () => {
			// Arrange
			signInAs(firstHostId, { role: "host" });

			// Act
			const updated = await patch(`${API_PREFIX}/host/vans/${mine.id}`, {
				price: 210,
				amenities: ["heater"],
			});

			// Assert
			expect(updated.status).toBe(200);
			expect(await updated.json()).toEqual({
				...fullVan(mine),
				price: 210,
				amenities: ["heater"],
			});

			const detail = await get(`${API_PREFIX}/host/vans/${mine.id}`);
			expect(detail.status).toBe(200);
			expect(await detail.json()).toEqual({
				...fullVan(mine),
				price: 210,
				amenities: ["heater"],
			});
		});

		it("retires a van with nothing to return", async () => {
			// Arrange
			signInAs(firstHostId, { role: "host" });

			// Act
			const response = await del(`${API_PREFIX}/host/vans/${mine.id}`);

			// Assert
			expect(response.status).toBe(204);
			expect(await response.text()).toBe("");

			const remaining = await get(`${API_PREFIX}/host/vans`);
			expect(await remaining.json()).toEqual({ data: [] });
		});

		it("will not tell one host that another host's van exists", async () => {
			// Arrange
			signInAs(firstHostId, { role: "host" });

			// Act
			const detail = await get(`${API_PREFIX}/host/vans/${theirs.id}`);
			const edit = await patch(`${API_PREFIX}/host/vans/${theirs.id}`, {
				price: 1,
			});
			const remove = await del(`${API_PREFIX}/host/vans/${theirs.id}`);

			// Assert
			expect(detail.status).toBe(404);
			expect(await detail.json()).toEqual({ message: "Van not found." });
			expect(edit.status).toBe(404);
			expect(remove.status).toBe(404);
		});
	});

	describe("bookings and figures", () => {
		let vanA: Json;
		let vanB: Json;
		let incomeAt: Date;

		beforeEach(async () => {
			await seed();
			vanA = (await createVan(firstHostId, {
				name: "Alpha",
				price: 100,
			})) as unknown as Json;
			vanB = (await createVan(firstHostId, {
				name: "Bravo",
				price: 50,
				imageUrl: "https://images.example.test/bravo.jpg",
			})) as unknown as Json;
			await createVan(secondHostId, { name: "Delta" });

			incomeAt = new Date();

			await createBooking(renterId, vanA.id as string, {
				status: "confirmed",
				totalPrice: 300,
				createdAt: incomeAt,
			});
			await createBooking(renterId, vanB.id as string, {
				status: "completed",
				totalPrice: 200,
				createdAt: incomeAt,
			});
			await createBooking(renterId, vanA.id as string, {
				status: "pending",
				totalPrice: 999,
				createdAt: incomeAt,
			});
			await createBooking(renterId, vanA.id as string, {
				status: "confirmed",
				totalPrice: 5000,
				createdAt: new Date(incomeAt.getTime() - 40 * 24 * 60 * 60 * 1000),
			});
		});

		afterEach(async () => {
			await prisma.review.deleteMany();
		});

		it("lists the bookings on the caller's vans with the renter attached", async () => {
			// Arrange
			signInAs(firstHostId, { role: "host" });

			// Act
			const response = await get(
				`${API_PREFIX}/host/bookings?sort=startDate&order=asc&limit=50`,
			);

			// Assert
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: Json[]; meta: Json };

			expect(body.data).toHaveLength(4);
			expect(body.data[0]).toEqual({
				id: expect.any(String),
				startDate: "2026-12-01",
				endDate: "2026-12-02",
				guests: 1,
				totalPrice: expect.any(Number),
				status: expect.any(String),
				createdAt: expect.any(String),
				renter: { id: renterId, name: "host.renter" },
				van: {
					id: expect.any(String),
					name: expect.any(String),
					imageUrl: expect.any(String),
					type: "simple",
				},
			});
			expect(body.meta).toEqual({
				page: 1,
				limit: 50,
				total: 4,
				totalPages: 1,
			});
		});

		it("confirms a booking the caller is holding", async () => {
			// Arrange
			const pending = await createBooking(renterId, vanB.id as string, {
				status: "pending",
				startDate: new Date(`${isoDate(20)}T00:00:00.000Z`),
				endDate: new Date(`${isoDate(21)}T00:00:00.000Z`),
			});
			signInAs(firstHostId, { role: "host" });

			// Act
			const response = await patch(
				`${API_PREFIX}/host/bookings/${pending.id}/status`,
				{
					status: "confirmed",
				},
			);

			// Assert
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				id: pending.id,
				startDate: isoDate(20),
				endDate: isoDate(21),
				guests: 1,
				totalPrice: 100,
				status: "confirmed",
				createdAt: pending.createdAt.toISOString(),
				renter: { id: renterId, name: "host.renter" },
				van: {
					id: vanB.id,
					name: "Bravo",
					imageUrl: "https://images.example.test/bravo.jpg",
					type: "simple",
				},
			});
		});

		it("refuses to confirm over a booking already confirmed", async () => {
			// Arrange
			const pending = await createBooking(renterId, vanA.id as string, {
				status: "pending",
				startDate: new Date(`${isoDate(5)}T00:00:00.000Z`),
				endDate: new Date(`${isoDate(6)}T00:00:00.000Z`),
			});
			await createBooking(renterId, vanA.id as string, {
				status: "confirmed",
				startDate: new Date(`${isoDate(5)}T00:00:00.000Z`),
				endDate: new Date(`${isoDate(6)}T00:00:00.000Z`),
			});
			signInAs(firstHostId, { role: "host" });

			// Act
			const response = await patch(
				`${API_PREFIX}/host/bookings/${pending.id}/status`,
				{
					status: "confirmed",
				},
			);

			// Assert
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				message:
					"Confirming this booking would conflict with another confirmed booking.",
			});
		});

		it("refuses to complete a trip that has not ended", async () => {
			// Arrange
			const upcoming = await createBooking(renterId, vanA.id as string, {
				status: "confirmed",
				startDate: new Date(`${isoDate(5)}T00:00:00.000Z`),
				endDate: new Date(`${isoDate(9)}T00:00:00.000Z`),
			});
			signInAs(firstHostId, { role: "host" });

			// Act
			const response = await patch(
				`${API_PREFIX}/host/bookings/${upcoming.id}/status`,
				{
					status: "completed",
				},
			);

			// Assert
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				message: "Booking cannot be completed before its end date.",
			});
		});

		it("refuses a booking that has already been settled", async () => {
			// Arrange
			const settled = await createBooking(renterId, vanA.id as string, {
				status: "completed",
				startDate: new Date(`${isoDate(-9)}T00:00:00.000Z`),
				endDate: new Date(`${isoDate(-1)}T00:00:00.000Z`),
			});
			signInAs(firstHostId, { role: "host" });

			// Act
			const response = await patch(
				`${API_PREFIX}/host/bookings/${settled.id}/status`,
				{
					status: "confirmed",
				},
			);

			// Assert
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				message: "Invalid booking status transition.",
			});
		});

		it("answers another host's booking id with not found", async () => {
			// Arrange
			const otherVan = (await createVan(secondHostId, {
				name: "Echo",
			})) as unknown as Json;
			const theirs = await createBooking(renterId, otherVan.id as string, {
				status: "pending",
			});
			signInAs(firstHostId, { role: "host" });

			// Act
			const response = await patch(
				`${API_PREFIX}/host/bookings/${theirs.id}/status`,
				{
					status: "confirmed",
				},
			);

			// Assert
			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({ message: "Booking not found." });
		});

		it("totals the last thirty days for the dashboard", async () => {
			// Arrange
			const completed = await prisma.booking.findFirst({
				where: { status: "completed" },
			});
			await createReview(renterId, vanB.id as string, completed?.id as string, {
				rating: 4,
			});
			signInAs(firstHostId, { role: "host" });

			// Act
			const response = await get(`${API_PREFIX}/host/dashboard`);

			// Assert — pending and out-of-window bookings count nowhere
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				days: 30,
				income: 500,
				bookingCount: 2,
				averageReviewScore: 4,
				reviewCount: 1,
				listedVanCount: 2,
			});
		});

		it("lists the income transactions inside their period", async () => {
			// Arrange
			signInAs(firstHostId, { role: "host" });

			// Act
			const response = await get(`${API_PREFIX}/host/income`);

			// Assert
			expect(response.status).toBe(200);

			const body = (await response.json()) as Json;
			const day = incomeAt.toISOString().slice(0, 10);
			const period = incomeAt.toISOString().slice(0, 7);

			expect(body.days).toBe(30);
			expect(body.total).toBe(500);
			expect(body.periods).toEqual([{ period, income: 500, bookingCount: 2 }]);
			expect(body.transactions).toHaveLength(2);
			expect(body.transactions).toEqual(
				expect.arrayContaining([
					{
						id: expect.any(String),
						amount: 300,
						date: day,
						van: { id: vanA.id, name: "Alpha", type: "simple" },
					},
					{
						id: expect.any(String),
						amount: 200,
						date: day,
						van: { id: vanB.id, name: "Bravo", type: "simple" },
					},
				]),
			);
		});

		it("summarises reviews with a five-star distribution", async () => {
			// Arrange
			const completed = await prisma.booking.findFirst({
				where: { status: "completed" },
			});
			const review = await createReview(
				renterId,
				vanB.id as string,
				completed?.id as string,
				{ rating: 4, text: "Quiet nights." },
			);
			signInAs(firstHostId, { role: "host" });

			// Act
			const response = await get(`${API_PREFIX}/host/reviews`);

			// Assert
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				days: 30,
				overallRating: 4,
				ratingDistribution: [
					{ rating: 5, count: 0, percentage: 0 },
					{ rating: 4, count: 1, percentage: 100 },
					{ rating: 3, count: 0, percentage: 0 },
					{ rating: 2, count: 0, percentage: 0 },
					{ rating: 1, count: 0, percentage: 0 },
				],
				reviews: [
					{
						id: review.id,
						renterName: "host.renter",
						date: review.createdAt.toISOString().slice(0, 10),
						rating: 4,
						text: "Quiet nights.",
						van: { id: vanB.id, name: "Bravo", type: "simple" },
					},
				],
			});
		});
	});
});
