import { describe, expect, it, vi } from "vitest";
import { ServiceUnavailableError } from "../../../src/errors/http-errors.js";
import { auth } from "../../../src/lib/auth.js";
import { sessionMiddleware } from "../../../src/middleware/session.js";
import {
	mockAuthenticatedUser,
	mockUnauthenticatedUser,
} from "../../helpers/auth.js";
import { session, user } from "../../helpers/fixtures/auth.js";
import { createMiddlewareContext } from "../../helpers/middleware-context.js";

vi.mock("../../../src/lib/auth.js", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

describe("sessionMiddleware", () => {
	it("sets the authenticated user and session", async () => {
		// Arrange
		mockAuthenticatedUser();

		const { c, next } = createMiddlewareContext();

		// Act
		await sessionMiddleware(c as never, next);

		// Assert
		expect(c.set).toHaveBeenCalledWith("user", user);

		expect(c.set).toHaveBeenCalledWith("session", session);

		expect(next).toHaveBeenCalledOnce();
	});

	it("sets null when no session exists", async () => {
		// Arrange
		mockUnauthenticatedUser();

		const { c, next } = createMiddlewareContext();

		// Act
		await sessionMiddleware(c as never, next);

		// Assert
		expect(c.set).toHaveBeenCalledWith("user", null);
		expect(c.set).toHaveBeenCalledWith("session", null);
		expect(next).toHaveBeenCalledOnce();
	});

	it("throws ServiceUnavailableError when getSession throws", async () => {
		// Arrange
		vi.mocked(auth.api.getSession).mockRejectedValue(
			new Error("Session error"),
		);

		const { c, next } = createMiddlewareContext();

		// Act & Assert
		await expect(sessionMiddleware(c as never, next)).rejects.toThrow(
			ServiceUnavailableError,
		);

		expect(c.set).not.toHaveBeenCalled();
		expect(next).not.toHaveBeenCalled();
	});
});
