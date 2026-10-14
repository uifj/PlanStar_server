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
import type { AuthUser } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/prisma.js";
import { objectService } from "../../src/modules/objects/service.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import {
	clearVanLifeRows,
	createBooking,
	createRenter,
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

const { del, patch, post } = await import("./helpers/request.js");

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

type Json = Record<string, unknown>;

describe.skipIf(!databaseAvailable)(
	"mirroring VanLife writes into objects",
	() => {
		let host: AuthUser;
		let renter: AuthUser;

		const vanBody = () => ({
			name: "Alpine Cruiser",
			price: 175,
			description: "A luxury cruiser for four.",
			imageUrl: "https://images.example.test/alpine.jpg",
			type: "luxury",
			location: "Aspen, CO",
			sleeps: 4,
			amenities: ["heater", "solar"],
		});

		beforeAll(async () => {
			await clearVanLifeRows();
			host = asAuthUser(await createVanLifeHost("mirror.host"));
			renter = asAuthUser(await createRenter("mirror.renter"));
		});

		afterEach(async () => {
			await clearVanLifeRows();
		});

		afterAll(async () => {
			await clearVanLifeRows();
			await prisma.user.deleteMany({
				where: { id: { startsWith: "mirror." } },
			});
		});

		async function publishVan() {
			signInAs(host.id, { role: "host" });

			const response = await post(`${API_PREFIX}/host/vans`, vanBody());

			expect(response.status).toBe(201);

			return (await response.json()) as Json;
		}

		it("mirrors a newly published van as an object of the van type", async () => {
			// Act
			const van = await publishVan();
			const object = await objectService.findById(host, van.id as string);

			// Assert
			expect(object.id).toBe(van.id);
			expect(object.name).toBe("Alpine Cruiser");
			expect(object.details).toMatchObject({
				price: 175,
				sleeps: 4,
				type: ["luxury"],
				amenities: ["heater", "solar"],
				location: "Aspen, CO",
			});
		});

		it("follows a van edit into the object", async () => {
			// Arrange
			const van = await publishVan();

			// Act
			signInAs(host.id, { role: "host" });
			const edited = await patch(`${API_PREFIX}/host/vans/${van.id}`, {
				price: 210,
			});

			// Assert
			expect(edited.status).toBe(200);
			expect(
				await objectService.findById(host, van.id as string),
			).toMatchObject({
				name: "Alpine Cruiser",
				details: { price: 210 },
			});
		});

		it("archives the object when the van retires", async () => {
			// Arrange
			const van = await publishVan();

			// Act
			signInAs(host.id, { role: "host" });
			const retired = await del(`${API_PREFIX}/host/vans/${van.id}`);

			// Assert
			expect(retired.status).toBe(204);
			expect(
				(await objectService.findById(host, van.id as string)).isArchived,
			).toBe(true);
		});

		it("mirrors a booking together with the van it holds", async () => {
			// Arrange — a van published before the mirror existed
			const van = await createVan(host.id, { price: 89 });

			// Act
			signInAs(renter.id, { role: "user" });
			const created = await post(`${API_PREFIX}/bookings`, {
				vanId: van.id,
				startDate: isoDate(30),
				endDate: isoDate(33),
				guests: 2,
			});
			const booking = (await created.json()) as Json;

			// Assert — the booking is an object, its van an edge, and the van caught up
			const object = await objectService.findById(renter, booking.id as string);

			expect(object.details).toMatchObject({
				totalPrice: 267,
				guests: 2,
				status: ["pending"],
				van: [van.id],
			});
			expect(await objectService.findById(renter, van.id)).toMatchObject({
				name: "Sierra Weekender",
			});
			expect(
				await prisma.link.count({
					where: { fromId: booking.id as string, relationKey: "van" },
				}),
			).toBe(1);
		});

		it("follows a cancellation into the object", async () => {
			// Arrange
			const van = await createVan(host.id, { price: 89 });
			signInAs(renter.id, { role: "user" });
			const created = await post(`${API_PREFIX}/bookings`, {
				vanId: van.id,
				startDate: isoDate(30),
				endDate: isoDate(31),
				guests: 1,
			});
			const booking = (await created.json()) as Json;

			// Act
			const cancelled = await post(
				`${API_PREFIX}/bookings/${booking.id}/cancel`,
				{},
			);

			// Assert
			expect(cancelled.status).toBe(200);
			expect(
				(await objectService.findById(renter, booking.id as string)).details,
			).toMatchObject({ status: ["cancelled"] });
		});

		it("mirrors a review with its booking and van edges", async () => {
			// Arrange
			const van = await createVan(host.id);
			const booking = await createBooking(renter.id, van.id, {
				status: "completed",
			});

			// Act
			signInAs(renter.id, { role: "user" });
			const created = await post(`${API_PREFIX}/reviews`, {
				bookingId: booking.id,
				rating: 5,
				text: "Warm nights.",
			});
			const review = (await created.json()) as Json;

			// Assert
			expect(created.status).toBe(201);
			expect(
				await objectService.findById(renter, review.id as string),
			).toMatchObject({
				details: { reviewRating: 5, reviewText: "Warm nights." },
			});
			expect(
				await prisma.link.count({
					where: {
						fromId: review.id as string,
						relationKey: { in: ["van", "booking"] },
					},
				}),
			).toBe(2);
		});
	},
);
