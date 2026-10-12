import { isUser } from "../../auth/roles.js";
import {
	BadRequestError,
	ForbiddenError,
	NotFoundError,
} from "../../errors/http-errors.js";
import { BookingStatus } from "../../generated/prisma/client.js";
import type { AuthUser } from "../../lib/auth.js";
import { translatePrismaError } from "../../lib/prisma-error.js";
import { toReview } from "./dto.js";
import { reviewRepository } from "./repository.js";
import type { CreateReview } from "./schema.js";

function ensureRenter(user: AuthUser) {
	if (!isUser(user)) {
		throw new ForbiddenError("You need a renter account to do this.");
	}
}

async function create(user: AuthUser, input: CreateReview) {
	ensureRenter(user);

	const booking = await reviewRepository.findBookingForReview(input.bookingId);

	if (!booking) {
		throw new NotFoundError("Booking not found.");
	}

	if (booking.userId !== user.id) {
		throw new ForbiddenError(
			"You do not have permission to review this booking.",
		);
	}

	if (booking.status !== BookingStatus.completed) {
		throw new BadRequestError("Only completed bookings can be reviewed.");
	}

	try {
		const review = await reviewRepository.create({
			user: {
				connect: {
					id: user.id,
				},
			},
			van: {
				connect: {
					id: booking.vanId,
				},
			},
			booking: {
				connect: {
					id: input.bookingId,
				},
			},
			rating: input.rating,
			text: input.text,
		});

		return toReview(review);
	} catch (error) {
		translatePrismaError(error, {
			conflict: "This booking already has a review.",
		});
	}
}

export const reviewService = {
	create,
};
