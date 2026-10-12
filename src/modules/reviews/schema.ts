import z from "zod";

export const ReviewSchema = z
	.object({
		id: z.string(),
		bookingId: z.string(),
		rating: z.number(),
		text: z.string(),
		createdAt: z.iso.datetime(),
	})
	.meta({ id: "Review" });

export const CreateReviewSchema = z
	.object({
		bookingId: z.string().trim().min(1, "Booking is required."),
		rating: z
			.number()
			.int("Rating must be a whole number.")
			.min(1, "Rating must be at least 1.")
			.max(5, "Rating cannot be more than 5."),
		text: z
			.string()
			.trim()
			.min(1, "Review text is required.")
			.max(1000, "Review text cannot exceed 1000 characters."),
	})
	.meta({ id: "CreateReview" });

export type CreateReview = z.infer<typeof CreateReviewSchema>;
