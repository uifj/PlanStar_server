import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "../../../src/errors/http-errors.js";
import { requireAuth } from "../../../src/middleware/require-auth.js";
import { createMiddlewareContext } from "../../helpers/middleware-context.js";

describe("requireAuth", () => {
	it("calls next when the user is authenticated", async () => {
		// Arrange
		const { c, next } = createMiddlewareContext({
			user: {
				id: "1",
			},
		});

		// Act
		await requireAuth(c as never, next);

		// Assert
		expect(next).toHaveBeenCalledOnce();
	});

	it("throws UnauthorizedError when the user is not authenticated", async () => {
		// Arrange
		const { c, next } = createMiddlewareContext({
			user: null,
		});

		// Act & Assert
		await expect(requireAuth(c as never, next)).rejects.toThrow(
			UnauthorizedError,
		);

		expect(next).not.toHaveBeenCalled();
	});
});
