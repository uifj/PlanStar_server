import type { Review } from "../../generated/prisma/client.js";

export function toReview(review: Review) {
	return {
		id: review.id,
		bookingId: review.bookingId,
		rating: review.rating,
		text: review.text,
		createdAt: review.createdAt.toISOString(),
	};
}
