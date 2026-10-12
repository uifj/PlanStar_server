import { describe, expect, it, vi } from "vitest";
import { API_PREFIX } from "../../src/config/constants.js";
import { session, user } from "../helpers/fixtures/auth.js";

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

describe("GET /me", () => {
	it("returns the current user", async () => {
		// Arrange
		vi.mocked(auth.api.getSession).mockResolvedValue({
			user,
			session,
		});

		// Act
		const response = await app.request(`${API_PREFIX}/me`);

		// Assert
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			id: user.id,
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerified,
			image: user.image,
			role: user.role,
		});
	});

	it("returns 401 when unauthenticated", async () => {
		// Arrange
		vi.mocked(auth.api.getSession).mockResolvedValue(null);

		// Act
		const response = await app.request(`${API_PREFIX}/me`);

		// Assert
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			message: "Please sign in to continue.",
		});
	});

	it("returns 503 when session lookup fails", async () => {
		// Arrange
		vi.mocked(auth.api.getSession).mockRejectedValue(
			new Error("Session lookup failed"),
		);

		// Act
		const response = await app.request(`${API_PREFIX}/me`);

		// Assert
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			message: "Authentication is temporarily unavailable. Please try again.",
		});
	});
});
