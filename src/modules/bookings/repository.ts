import {
	BookingStatus,
	Prisma,
	type Van,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { buildWhere } from "./filters.js";
import type { BookingListQuery } from "./schema.js";

const activeBookingStatuses = [BookingStatus.pending, BookingStatus.confirmed];
const MAX_CREATE_BOOKING_ATTEMPTS = 3;

async function findManyByUser(
	userId: string,
	query: Pick<BookingListQuery, "status">,
	options: {
		skip: number;
		take: number;
		orderBy: Prisma.BookingOrderByWithRelationInput;
	},
) {
	return prisma.booking.findMany({
		where: buildWhere(userId, query),
		include: {
			review: {
				select: {
					id: true,
					rating: true,
					text: true,
					createdAt: true,
				},
			},
			van: {
				select: {
					id: true,
					name: true,
					imageUrl: true,
					type: true,
					location: true,
				},
			},
		},
		orderBy: options.orderBy,
		skip: options.skip,
		take: options.take,
	});
}

async function countByUser(
	userId: string,
	query: Pick<BookingListQuery, "status">,
) {
	return prisma.booking.count({
		where: buildWhere(userId, query),
	});
}

async function findBookableVanById(id: string) {
	return prisma.van.findFirst({
		where: {
			id,
			archivedAt: null,
		},
	});
}

async function findOwnedById(userId: string, id: string) {
	return prisma.booking.findFirst({
		where: {
			id,
			userId,
		},
	});
}

async function createPendingIfAvailable(input: {
	userId: string;
	van: Van;
	startDate: Date;
	endDate: Date;
	guests: number;
	totalPrice: number;
}) {
	for (let attempt = 1; attempt <= MAX_CREATE_BOOKING_ATTEMPTS; attempt += 1) {
		try {
			return await prisma.$transaction(
				async (tx) => {
					const van = await tx.van.findFirst({
						where: {
							id: input.van.id,
							archivedAt: null,
						},
					});

					if (!van) {
						return {
							status: "van_unavailable",
						} as const;
					}

					const overlappingBooking = await tx.booking.findFirst({
						where: {
							vanId: input.van.id,
							status: {
								in: activeBookingStatuses,
							},
							startDate: {
								lt: input.endDate,
							},
							endDate: {
								gt: input.startDate,
							},
						},
					});

					if (overlappingBooking) {
						return {
							status: "overlap",
						} as const;
					}

					const booking = await tx.booking.create({
						data: {
							user: {
								connect: {
									id: input.userId,
								},
							},
							van: {
								connect: {
									id: input.van.id,
								},
							},
							startDate: input.startDate,
							endDate: input.endDate,
							guests: input.guests,
							totalPrice: input.totalPrice,
							status: BookingStatus.pending,
						},
					});

					return {
						status: "created",
						booking,
					} as const;
				},
				{
					isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
				},
			);
		} catch (error) {
			if (
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2034" &&
				attempt < MAX_CREATE_BOOKING_ATTEMPTS
			) {
				continue;
			}

			throw error;
		}
	}

	throw new Error("Failed to create booking after retries.");
}

async function updateOwnedStatus(
	userId: string,
	id: string,
	status: BookingStatus,
) {
	return prisma.booking.update({
		where: {
			id,
			userId,
		},
		data: {
			status,
		},
	});
}

export const bookingRepository = {
	findManyByUser,
	countByUser,
	findBookableVanById,
	findOwnedById,
	createPendingIfAvailable,
	updateOwnedStatus,
};
