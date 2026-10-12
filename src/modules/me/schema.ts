import z from "zod";

export const CurrentUserResponseSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.email(),
	emailVerified: z.boolean(),
	image: z.string().nullable().optional(),
	role: z.string().nullable(),
});
