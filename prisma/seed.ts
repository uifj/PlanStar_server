import { type AuthUser, auth } from "../src/lib/auth.js";
import { prisma } from "../src/lib/prisma.js";
import { VAN_LIFE_SPACE_ID } from "../src/modules/vanlife/constants.js";
import { vanLifeService } from "../src/modules/vanlife/service.js";
import {
	BOOKINGS,
	DEFAULT_PASSWORD,
	REVIEWS,
	SEED_DATE,
	USERS,
	VANS,
} from "./seed-data.js";

type UserSeed = (typeof USERS)[keyof typeof USERS];
type UserKey = keyof typeof USERS;
type VanKey = (typeof VANS)[number]["key"];
type BookingKey = (typeof BOOKINGS)[number]["key"];

async function createSeedUser(input: UserSeed) {
	await auth.api.createUser({
		body: {
			name: input.name,
			email: input.email,
			password: DEFAULT_PASSWORD,
			role: input.role,
		},
	});
}

async function updateSeedUser(input: UserSeed) {
	return await prisma.user.update({
		where: {
			email: input.email,
		},
		data: {
			role: input.role,
			emailVerified: true,
			updatedAt: SEED_DATE,
		},
	});
}

async function seedUsers() {
	for (const user of Object.values(USERS)) {
		const existing = await prisma.user.findUnique({
			where: {
				email: user.email,
			},
		});

		if (!existing) {
			await createSeedUser(user);
		}
	}

	return new Map(
		await Promise.all(
			Object.entries(USERS).map(async ([key, user]) => {
				const updatedUser = await updateSeedUser(user);

				return [key as UserKey, updatedUser.id] as const;
			}),
		),
	);
}

async function seedVans(userIds: Map<UserKey, string>) {
	const vanIds = new Map<VanKey, string>();

	for (const { key, hostKey, ...van } of VANS) {
		const hostId = userIds.get(hostKey);

		if (!hostId) {
			throw new Error(`Host not found: ${hostKey}`);
		}

		const createdVan = await prisma.van.create({
			data: {
				...van,
				amenities: [...van.amenities],
				hostId,
			},
		});

		vanIds.set(key, createdVan.id);
	}

	return vanIds;
}

async function seedBookings(
	userIds: Map<UserKey, string>,
	vanIds: Map<VanKey, string>,
) {
	const bookingIds = new Map<BookingKey, string>();

	for (const { key, userKey, vanKey, ...booking } of BOOKINGS) {
		const userId = userIds.get(userKey);
		const vanId = vanIds.get(vanKey);

		if (!userId) {
			throw new Error(`Renter not found: ${userKey}`);
		}

		if (!vanId) {
			throw new Error(`Van not found: ${vanKey}`);
		}

		const createdBooking = await prisma.booking.create({
			data: {
				...booking,
				userId,
				vanId,
			},
		});

		bookingIds.set(key, createdBooking.id);
	}

	return bookingIds;
}

async function seedReviews(bookingIds: Map<BookingKey, string>) {
	for (const { bookingKey, ...review } of REVIEWS) {
		const bookingId = bookingIds.get(bookingKey);

		if (!bookingId) {
			throw new Error(`Booking not found: ${bookingKey}`);
		}

		const booking = await prisma.booking.findUnique({
			where: {
				id: bookingId,
			},
		});

		if (!booking) {
			throw new Error(`Booking not found: ${bookingKey}`);
		}

		await prisma.review.create({
			data: {
				...review,
				userId: booking.userId,
				vanId: booking.vanId,
				bookingId: booking.id,
			},
		});
	}
}

async function seedVanLifeObjects(userIds: Map<UserKey, string>) {
	const asActor = (userId: string) =>
		prisma.user
			.findUniqueOrThrow({ where: { id: userId } })
			.then((user) => user as unknown as AuthUser);

	const host = await asActor(userIds.get("host") as string);
	const spaceId = await vanLifeService.ensureVanLifeSpace(host);

	// Everyone who owns seeded rows needs a membership to read them back.
	for (const userId of userIds.values()) {
		await vanLifeService.ensureVanLifeSpace(await asActor(userId));
	}

	return vanLifeService.backfillVanLife(host, spaceId);
}

async function main() {
	console.log("Seeding database...");

	await prisma.review.deleteMany();
	await prisma.booking.deleteMany();
	await prisma.van.deleteMany();
	// The mirrored objects of the previous run would otherwise outlive the rows
	// they were projected from.
	await prisma.obj.deleteMany({ where: { spaceId: VAN_LIFE_SPACE_ID } });
	console.log("Existing vans, bookings, and reviews cleared");

	const userIds = await seedUsers();
	console.log("Users seeded");

	const vanIds = await seedVans(userIds);
	console.log("Vans seeded");

	const bookingIds = await seedBookings(userIds, vanIds);
	console.log("Bookings seeded");

	await seedReviews(bookingIds);
	console.log("Reviews seeded");

	const copied = await seedVanLifeObjects(userIds);
	console.log(
		`VanLife objects seeded: ${copied.vans} vans, ${copied.bookings} bookings, ${copied.reviews} reviews`,
	);

	console.log("Database seeded successfully.");
}

try {
	await main();
} catch (error) {
	console.error("Failed to seed database.");
	console.error(error);
	process.exitCode = 1;
} finally {
	await prisma.$disconnect();
}
