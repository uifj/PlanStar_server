import z from "zod";

export const TripPlannerMessageSchema = z.object({
	chatId: z
		.string()
		.min(1)
		.optional()
		.describe("Continue an existing conversation; omit to start a new one."),
	message: z.string().min(1).max(2000).describe("What the traveller asks."),
});

export const TripPlannerReplySchema = z.object({
	chatId: z.string(),
	snapshotId: z.string().optional(),
	reply: z.string(),
});

export type TripPlannerMessage = z.infer<typeof TripPlannerMessageSchema>;
export type TripPlannerReply = z.infer<typeof TripPlannerReplySchema>;
