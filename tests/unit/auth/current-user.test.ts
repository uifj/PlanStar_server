import { describe, expect, it, vi } from "vitest";
import { getCurrentUser } from "../../../src/auth/current-user.js";
import { UnauthorizedError } from "../../../src/errors/http-errors.js";
import { user } from "../../helpers/fixtures/auth.js";

describe("getCurrentUser", () => {
	it("returns the authenticated user", () => {
		// Arrange
		const c = {
			get: vi.fn().mockReturnValue(user),
		};

		// Act
		const result = getCurrentUser(c as never);

		// Assert
		expect(c.get).toHaveBeenCalledWith("user");
		expect(result).toBe(user);
	});

	it("throws UnauthorizedError when there is no user", () => {
		// Arrange
		const c = {
			get: vi.fn().mockReturnValue(null),
		};

		// Act & Assert
		expect(() => getCurrentUser(c as never)).toThrow(UnauthorizedError);
		expect(c.get).toHaveBeenCalledWith("user");
	});
});
