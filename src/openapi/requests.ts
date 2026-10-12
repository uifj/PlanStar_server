import type { ZodType } from "zod";

export const requestBody = <T extends ZodType>(schema: T, required = true) => ({
	body: {
		required,
		content: {
			"application/json": {
				schema,
			},
		},
	},
});
