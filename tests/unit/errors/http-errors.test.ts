import { describe, expect, it } from "vitest";
import { AppError } from "../../../src/errors/app-error.js";
import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ServiceUnavailableError,
	UnauthorizedError,
	ValidationError,
} from "../../../src/errors/http-errors.js";

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
		"creates %s with the default status and message",
		(ErrorClass, statusCode, message) => {
			// Act
			const error = new ErrorClass();

			// Assert
			expect(error).toBeInstanceOf(AppError);
			expect(error).toBeInstanceOf(ErrorClass);
			expect(error.name).toBe(ErrorClass.name);
			expect(error.statusCode).toBe(statusCode);
			expect(error.message).toBe(message);
		},
	);

	it("supports custom messages", () => {
		// Act
		const error = new NotFoundError("Post not found");

		// Assert
		expect(error.statusCode).toBe(404);
		expect(error.message).toBe("Post not found");
	});
});
