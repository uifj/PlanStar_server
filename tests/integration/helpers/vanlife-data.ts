import type { Prisma } from "../../../src/generated/prisma/client.js";
import { prisma } from "../../../src/lib/prisma.js";

type VanFixture = Omit<Prisma.VanUncheckedCreateInput, "hostId">;

const DEFAULT_VAN: VanFixture = {
	name: "Sierra Weekender",
	description: "A modest explorer for two.",
	imageUrl: "https://images.example.test/sierra-weekender.jpg",
	type: "simple",
	location: "Mammoth Lakes, CA",
	sleeps: 2,
	price: 89,
};

async function createUserWithRole(id: string, role: string) {
	return prisma.user.create({
		data: {
			id,
			name: id,
			email: `${id}@vanlife.test`,
			role,
			emailVerified: true,
		},
	});
}

export async function createVanLifeHost(id: string) {
	return createUserWithRole(id, "host");
}

export async function createRenter(id: string) {
	return createUserWithRole(id, "user");
}

export async function createVan(
	hostId: string,
	overrides: Partial<VanFixture> = {},
) {
	return prisma.van.create({
		data: { ...DEFAULT_VAN, ...overrides, hostId },
	});
}

/** The same fields, shaped for POST /host/vans so a fixture can publish through the route. */
export function vanRequestBody(overrides: Record<string, unknown> = {}) {
	return { ...DEFAULT_VAN, ...overrides };
}

type BookingFixture = Omit<
	Prisma.BookingUncheckedCreateInput,
	"userId" | "vanId"
>;

export async function createBooking(
	userId: string,
	vanId: string,
	overrides: Partial<BookingFixture> = {},
) {
	return prisma.booking.create({
		data: {
			userId,
			vanId,
			startDate: new Date("2026-12-01T00:00:00.000Z"),
			endDate: new Date("2026-12-02T00:00:00.000Z"),
			guests: 1,
			totalPrice: 100,
			status: "confirmed",
			...overrides,
		},
	});
}

export async function createReview(
	userId: string,
	vanId: string,
	bookingId: string,
	overrides: Partial<Prisma.ReviewUncheckedCreateInput> = {},
) {
	return prisma.review.create({
		data: {
			userId,
			vanId,
			bookingId,
			rating: 5,
			text: "Loved the quiet.",
			...overrides,
		},
	});
}

/** Dates are validated against today, so fixtures derive them instead of hard-coding. */
export function isoDate(daysFromNow: number) {
	const date = new Date();

	date.setUTCDate(date.getUTCDate() + daysFromNow);

	return date.toISOString().slice(0, 10);
}

/**
 * Empties the VanLife fixture completely: the legacy rows and the object core
 * they are mirrored into, including the shared space and its registry. Route
 * reads answer from the object core, so clearing only the tables would leave a
 * previous test's objects visible.
 */
export async function clearVanLifeRows() {
	await prisma.$transaction([
		prisma.link.deleteMany(),
		prisma.review.deleteMany(),
		prisma.booking.deleteMany(),
		prisma.van.deleteMany(),
		prisma.block.deleteMany(),
		prisma.obj.deleteMany(),
		prisma.relation.deleteMany(),
		prisma.objectType.deleteMany(),
		prisma.spaceMember.deleteMany(),
		prisma.space.deleteMany(),
	]);
}
