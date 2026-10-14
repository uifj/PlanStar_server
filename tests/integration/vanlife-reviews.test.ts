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
	createVan,
	createVanLifeHost,
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

const { post } = await import("./helpers/request.js");

describe.skipIf(!databaseAvailable)("trip reviews", () => {
	let hostId: string;
	let renterId: string;
	let otherRenterId: string;
	let vanId: string;
	let completedBookingId: string;

	beforeAll(async () => {
		await clearVanLifeRows();
		hostId = (await createVanLifeHost("reviews.host")).id;
		renterId = (await createRenter("reviews.renter")).id;
		otherRenterId = (await createRenter("reviews.other")).id;
		vanId = (await createVan(hostId)).id;
		completedBookingId = (
			await createBooking(renterId, vanId, { status: "completed" })
		).id;
	});

	afterEach(async () => {
		await prisma.review.deleteMany();
	});

	afterAll(async () => {
		await clearVanLifeRows();
		await prisma.user.deleteMany({
			where: { id: { startsWith: "reviews." } },
		});
	});

	async function review(
		bookingId: string,
		body: Record<string, unknown> = {},
		user = renterId,
	) {
		signInAs(user, { role: "user" });

		return post(`${API_PREFIX}/reviews`, {
			bookingId,
			rating: 5,
			text: "The heat kept us warm.",
			...body,
		});
	}

	it("asks a signed-in caller before reviewing", async () => {
		// Arrange
		signedOut();

		// Act
		const response = await post(`${API_PREFIX}/reviews`, {
			bookingId: completedBookingId,
			rating: 5,
			text: "The heat kept us warm.",
		});

		// Assert
		expect(response.status).toBe(401);
	});

	it("writes a review for a trip that ended", async () => {
		// Act
		const response = await review(completedBookingId);

		// Assert
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({
			id: expect.any(String),
			bookingId: completedBookingId,
			rating: 5,
			text: "The heat kept us warm.",
			createdAt: expect.any(String),
		});
	});

	it("refuses a booking that is not on the books", async () => {
		// Act
		const response = await review("none-such");

		// Assert
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ message: "Booking not found." });
	});

	it("refuses to review another renter's trip", async () => {
		// Act
		const response = await review(completedBookingId, {}, otherRenterId);

		// Assert
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			message: "You do not have permission to review this booking.",
		});
	});

	it("refuses a trip that has not ended yet", async () => {
		// Arrange
		const upcoming = await createBooking(renterId, vanId, {
			status: "confirmed",
		});

		// Act
		const response = await review(upcoming.id);

		// Assert
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			message: "Only completed bookings can be reviewed.",
		});
	});

	it("keeps one review per booking", async () => {
		// Arrange
		expect((await review(completedBookingId)).status).toBe(201);

		// Act
		const response = await review(completedBookingId, { rating: 4 });

		// Assert
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			message: "This booking already has a review.",
		});
	});

	it("refuses a host with no renter account", async () => {
		// Arrange — signed in as the host of the van
		signInAs(hostId, { role: "host" });

		// Act
		const response = await post(`${API_PREFIX}/reviews`, {
			bookingId: completedBookingId,
			rating: 5,
			text: "Self review.",
		});

		// Assert
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			message: "You need a renter account to do this.",
		});
	});

	it("refuses a rating outside the stars", async () => {
		// Act
		const response = await review(completedBookingId, { rating: 9 });

		// Assert — a schema rejection is a 400 and writes nothing
		expect(response.status).toBe(400);
		expect(await prisma.review.count()).toBe(0);
	});
});
