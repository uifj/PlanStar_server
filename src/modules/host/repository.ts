import { BookingStatus, type Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

const incomeStatuses = [BookingStatus.confirmed, BookingStatus.completed];

function ownedVanWhere(hostId: string): Prisma.VanWhereInput {
	return {
		hostId,
		archivedAt: null,
	};
}

function hostBookingWhere(hostId: string): Prisma.BookingWhereInput {
	return {
		van: {
			hostId,
			archivedAt: null,
		},
	};
}

function hostReviewWhere(hostId: string): Prisma.ReviewWhereInput {
	return {
		van: {
			hostId,
			archivedAt: null,
		},
	};
}

async function createVan(data: Prisma.VanCreateInput) {
	return prisma.van.create({
		data,
	});
}

async function updateOwnedVan(
	hostId: string,
	id: string,
	data: Prisma.VanUpdateInput,
) {
	return prisma.van.update({
		where: {
			id,
			hostId,
			archivedAt: null,
		},
		data,
	});
}

async function archiveOwnedVan(hostId: string, id: string) {
	return prisma.van.update({
		where: {
			id,
			hostId,
			archivedAt: null,
		},
		data: {
			archivedAt: new Date(),
		},
	});
}

async function getIncome(hostId: string, since: Date) {
	return prisma.booking.aggregate({
		where: {
			...hostBookingWhere(hostId),
			createdAt: {
				gte: since,
			},
			status: {
				in: incomeStatuses,
			},
		},
		_sum: {
			totalPrice: true,
		},
	});
}

async function countRangeBookings(hostId: string, since: Date) {
	return prisma.booking.count({
		where: {
			...hostBookingWhere(hostId),
			createdAt: {
				gte: since,
			},
			status: {
				in: incomeStatuses,
			},
		},
	});
}

async function getAverageReviewScore(hostId: string, since: Date) {
	return prisma.review.aggregate({
		where: {
			...hostReviewWhere(hostId),
			createdAt: {
				gte: since,
			},
		},
		_avg: {
			rating: true,
		},
	});
}

async function countReviews(hostId: string, since: Date) {
	return prisma.review.count({
		where: {
			...hostReviewWhere(hostId),
			createdAt: {
				gte: since,
			},
		},
	});
}

async function countListedVans(hostId: string) {
	return prisma.van.count({
		where: ownedVanWhere(hostId),
	});
}

async function findIncomeBookings(hostId: string, since: Date) {
	return prisma.booking.findMany({
		where: {
			...hostBookingWhere(hostId),
			createdAt: {
				gte: since,
			},
			status: {
				in: incomeStatuses,
			},
		},
		include: {
			van: {
				select: {
					id: true,
					name: true,
					type: true,
				},
			},
		},
		orderBy: {
			createdAt: "desc",
		},
	});
}

async function findBookings(
	hostId: string,
	query: {
		status?: BookingStatus;
	},
	options: {
		skip: number;
		take: number;
		orderBy: Prisma.BookingOrderByWithRelationInput;
	},
) {
	return prisma.booking.findMany({
		where: {
			...hostBookingWhere(hostId),
			status: query.status,
		},
		include: {
			user: {
				select: {
					id: true,
					name: true,
				},
			},
			van: {
				select: {
					id: true,
					name: true,
					imageUrl: true,
					type: true,
				},
			},
		},
		orderBy: options.orderBy,
		skip: options.skip,
		take: options.take,
	});
}

async function countBookings(
	hostId: string,
	query: {
		status?: BookingStatus;
	},
) {
	return prisma.booking.count({
		where: {
			...hostBookingWhere(hostId),
			status: query.status,
		},
	});
}

async function findBookingById(hostId: string, id: string) {
	return prisma.booking.findFirst({
		where: {
			...hostBookingWhere(hostId),
			id,
		},
		include: {
			user: {
				select: {
					id: true,
					name: true,
				},
			},
			van: {
				select: {
					id: true,
					name: true,
					imageUrl: true,
					type: true,
				},
			},
		},
	});
}

async function findConfirmedOverlap(
	vanId: string,
	startDate: Date,
	endDate: Date,
	excludeBookingId: string,
) {
	return prisma.booking.findFirst({
		where: {
			id: {
				not: excludeBookingId,
			},
			vanId,
			status: BookingStatus.confirmed,
			startDate: {
				lt: endDate,
			},
			endDate: {
				gt: startDate,
			},
		},
	});
}

async function updateBookingStatus(id: string, status: BookingStatus) {
	return prisma.booking.update({
		where: {
			id,
		},
		data: {
			status,
		},
		include: {
			user: {
				select: {
					id: true,
					name: true,
				},
			},
			van: {
				select: {
					id: true,
					name: true,
					imageUrl: true,
					type: true,
				},
			},
		},
	});
}

async function findReviews(hostId: string, since: Date) {
	return prisma.review.findMany({
		where: {
			...hostReviewWhere(hostId),
			createdAt: {
				gte: since,
			},
		},
		include: {
			user: {
				select: {
					name: true,
				},
			},
			van: {
				select: {
					id: true,
					name: true,
					type: true,
				},
			},
		},
		orderBy: {
			createdAt: "desc",
		},
	});
}

async function getRatingCounts(hostId: string, since: Date) {
	return prisma.review.groupBy({
		by: ["rating"],
		where: {
			...hostReviewWhere(hostId),
			createdAt: {
				gte: since,
			},
		},
		_count: {
			rating: true,
		},
	});
}

export const hostRepository = {
	createVan,
	updateOwnedVan,
	archiveOwnedVan,
	getIncome,
	countRangeBookings,
	getAverageReviewScore,
	countReviews,
	countListedVans,
	findIncomeBookings,
	findBookings,
	countBookings,
	findBookingById,
	findConfirmedOverlap,
	updateBookingStatus,
	findReviews,
	getRatingCounts,
};
