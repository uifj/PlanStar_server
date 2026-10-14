import {
	BookingStatus,
	Prisma,
	type Van,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { buildOverlapWhere, buildWhere } from "./filters.js";
import type { BookingListQuery } from "./schema.js";

const MAX_CREATE_BOOKING_ATTEMPTS = 3;

const LIST_INCLUDE = {
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
} satisfies Prisma.BookingInclude;

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
		include: LIST_INCLUDE,
		orderBy: options.orderBy,
		skip: options.skip,
		take: options.take,
	});
}

// Trips that have not started losing their future, in the order they happen.
async function findUpcomingByUser(userId: string, from: Date) {
	return prisma.booking.findMany({
		where: {
			userId,
			startDate: {
				gte: from,
			},
		},
		include: LIST_INCLUDE,
		orderBy: {
			startDate: "asc",
		},
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

async function findActiveOverlap(
	vanId: string,
	startDate: Date,
	endDate: Date,
) {
	return prisma.booking.findFirst({
		where: buildOverlapWhere(vanId, startDate, endDate),
		select: {
			startDate: true,
			endDate: true,
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
						where: buildOverlapWhere(
							input.van.id,
							input.startDate,
							input.endDate,
						),
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
	findUpcomingByUser,
	countByUser,
	findBookableVanById,
	findOwnedById,
	findActiveOverlap,
	createPendingIfAvailable,
	updateOwnedStatus,
};
