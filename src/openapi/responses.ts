import type { ZodType } from "zod";
import { ErrorResponseSchema } from "./schema.js";

export const response = (description: string, schema: ZodType) => ({
	description,
	content: {
		"application/json": {
			schema,
		},
	},
});

// Successful response helpers
export const okResponse = (description: string, schema: ZodType) => ({
	200: response(description, schema),
});

export const createdResponse = (description: string, schema: ZodType) => ({
	201: response(description, schema),
});

export const noContentResponse = (description = "No content") => ({
	204: { description },
});

// Error response helpers
export const errorResponse = (description: string) =>
	response(description, ErrorResponseSchema);

export const unauthorizedResponse = {
	401: errorResponse("Please sign in to continue."),
};

export const forbiddenResponse = {
	403: errorResponse("You do not have permission to access this resource."),
};

export const notFoundResponse = (description = "Not found.") => ({
	404: errorResponse(description),
});

export const serviceUnavailableResponse = (
	description = "Service unavailable.",
	schema: ZodType = ErrorResponseSchema,
) => ({
	503: response(description, schema),
});
