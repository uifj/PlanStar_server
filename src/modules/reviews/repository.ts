import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

async function findBookingForReview(id: string) {
	return prisma.booking.findFirst({
		where: {
			id,
			van: {
				archivedAt: null,
			},
		},
		select: {
			id: true,
			userId: true,
			vanId: true,
			status: true,
		},
	});
}

async function create(data: Prisma.ReviewCreateInput) {
	return prisma.review.create({
		data,
	});
}

export const reviewRepository = {
	findBookingForReview,
	create,
};
