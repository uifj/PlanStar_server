import z from "zod";

export const HostRegisterSchema = z.object({
	name: z.string().trim().min(1, "Name is required."),
	email: z.email("Enter a valid email address."),
	password: z.string().min(8, "Password must be at least 8 characters."),
	rememberMe: z.boolean().optional(),
});
