import { describe, expect, it } from "vitest";
import z from "zod";
import {
	createdResponse,
	errorResponse,
	forbiddenResponse,
	noContentResponse,
	notFoundResponse,
	okResponse,
	response,
	serviceUnavailableResponse,
	unauthorizedResponse,
} from "../../../src/openapi/responses.js";
import { ErrorResponseSchema } from "../../../src/openapi/schema.js";

const TestSchema = z.object({
	id: z.string(),
});

describe("OpenAPI response helpers", () => {
	it("builds a JSON response", () => {
		// Act
		const result = response("Test response", TestSchema);

		// Assert
		expect(result).toEqual({
			description: "Test response",
			content: {
				"application/json": {
					schema: TestSchema,
				},
			},
		});
	});

	it("builds success responses", () => {
		// Assert
		expect(okResponse("OK", TestSchema)).toEqual({
			200: response("OK", TestSchema),
		});
		expect(createdResponse("Created", TestSchema)).toEqual({
			201: response("Created", TestSchema),
		});
		expect(noContentResponse()).toEqual({
			204: { description: "No content" },
		});
	});

	it("builds error responses", () => {
		// Assert
		expect(errorResponse("Invalid")).toEqual(
			response("Invalid", ErrorResponseSchema),
		);
		expect(unauthorizedResponse).toEqual({
			401: response("Please sign in to continue.", ErrorResponseSchema),
		});
		expect(forbiddenResponse).toEqual({
			403: response(
				"You do not have permission to access this resource.",
				ErrorResponseSchema,
			),
		});
		expect(notFoundResponse()).toEqual({
			404: response("Not found.", ErrorResponseSchema),
		});
		expect(notFoundResponse("Post not found.")).toEqual({
			404: response("Post not found.", ErrorResponseSchema),
		});
	});

	it("builds service unavailable responses with default and custom schemas", () => {
		// Assert
		expect(serviceUnavailableResponse()).toEqual({
			503: response("Service unavailable.", ErrorResponseSchema),
		});
		expect(serviceUnavailableResponse("Unavailable", TestSchema)).toEqual({
			503: response("Unavailable", TestSchema),
		});
	});
});
