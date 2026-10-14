import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../../src/errors/app-error.js";
import { logger } from "../../../src/lib/logger.js";
import { errorHandler } from "../../../src/middleware/error.js";
import { createErrorContext } from "../../helpers/error-context.js";

vi.mock("../../../src/lib/logger.js", () => ({
	logger: {
		error: vi.fn(),
		warn: vi.fn(),
	},
}));

describe("errorHandler", () => {
	it("returns the AppError response", () => {
		// Arrange
		const c = createErrorContext();
		const error = new AppError("Invalid request", 400);

		// Act
		const response = errorHandler(error, c as never);

		// Assert
		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req-123",
				method: "GET",
				path: "/test",
				status: 400,
				err: error,
			}),
			"Request failed",
		);

		expect(c.json).toHaveBeenCalledWith(
			{
				message: "Invalid request",
			},
			400,
		);

		expect(response).toEqual({
			body: {
				message: "Invalid request",
			},
			status: 400,
		});
	});

	it("returns 500 for unexpected errors", () => {
		// Arrange
		const c = createErrorContext();
		const error = new Error("Unexpected");

		// Act
		const response = errorHandler(error, c as never);

		// Assert
		expect(logger.error).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req-123",
				method: "GET",
				path: "/test",
				status: 500,
				err: error,
			}),
			"Unhandled error",
		);

		expect(c.json).toHaveBeenCalledWith(
			{
				message: "Internal Server Error",
			},
			500,
		);

		expect(response).toEqual({
			body: {
				message: "Internal Server Error",
			},
			status: 500,
		});
	});

	it("returns the client status for a request the framework rejected", () => {
		// Arrange — Hono raises HTTPException when a body is not valid JSON
		const c = createErrorContext();
		const error = new HTTPException(400, {
			message: "Malformed JSON in request body",
		});

		// Act
		const response = errorHandler(error, c as never);

		// Assert — a bad request must not be logged or answered as a server fault
		expect(logger.error).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ status: 400 }),
			"Request failed",
		);
		expect(response).toEqual({
			body: { message: "Malformed JSON in request body" },
			status: 400,
		});
	});
});
