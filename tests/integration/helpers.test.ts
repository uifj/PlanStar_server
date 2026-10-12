import { describe, expect, it, vi } from "vitest";
import { API_PREFIX } from "../../src/config/constants.js";
import { AppError } from "../../src/errors/app-error.js";
import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ServiceUnavailableError,
	UnauthorizedError,
	ValidationError,
} from "../../src/errors/http-errors.js";
import {
	createdResponse,
	noContentResponse,
	notFoundResponse,
	okResponse,
	serviceUnavailableResponse,
} from "../../src/openapi/responses.js";
import { ErrorResponseSchema } from "../../src/openapi/schema.js";
import { paginated } from "../../src/response/payload.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
		handler: vi.fn(),
	},
}));

const { auth } = await import("../../src/lib/auth.js");
const { default: app } = await import("../../src/app.js");

describe("Auth routes", () => {
	it("forwards auth requests to Better Auth", async () => {
		// Arrange
		const authResponse = new Response("ok", {
			status: 202,
		});

		vi.mocked(auth.handler).mockResolvedValue(authResponse);

		// Act
		const response = await app.request(`${API_PREFIX}/auth/sign-in/email`, {
			method: "POST",
		});

		// Assert
		expect(response.status).toBe(202);
		expect(await response.text()).toBe("ok");
		expect(auth.handler).toHaveBeenCalledOnce();
	});
});

describe("HTTP errors", () => {
	it.each([
		[BadRequestError, 400, "The request could not be processed."],
		[UnauthorizedError, 401, "Please sign in to continue."],
		[
			ForbiddenError,
			403,
			"You do not have permission to access this resource.",
		],
		[NotFoundError, 404, "Resource not found."],
		[
			ConflictError,
			409,
			"The request conflicts with the current resource state.",
		],
		[ValidationError, 422, "Validation failed"],
		[ServiceUnavailableError, 503, "Service unavailable"],
	] as const)(
		"creates %s with its default response status",
		(ErrorClass, statusCode, message) => {
			// Act
			const error = new ErrorClass();

			// Assert
			expect(error).toBeInstanceOf(AppError);
			expect(error.name).toBe(ErrorClass.name);
			expect(error.statusCode).toBe(statusCode);
			expect(error.message).toBe(message);
		},
	);
});

describe("response helpers", () => {
	it("wraps paginated payloads", () => {
		// Assert
		expect(
			paginated([{ id: "van_1" }], {
				page: 1,
				limit: 10,
				total: 1,
				totalPages: 1,
			}),
		).toEqual({
			data: [{ id: "van_1" }],
			meta: {
				page: 1,
				limit: 10,
				total: 1,
				totalPages: 1,
			},
		});
	});

	it("builds OpenAPI response objects", () => {
		// Assert
		expect(okResponse("OK", ErrorResponseSchema)).toHaveProperty("200");
		expect(createdResponse("Created", ErrorResponseSchema)).toHaveProperty(
			"201",
		);
		expect(noContentResponse()).toEqual({
			204: {
				description: "No content",
			},
		});
		expect(notFoundResponse("Missing")).toHaveProperty("404");
		expect(serviceUnavailableResponse()).toHaveProperty("503");
	});
});
