import { vi } from "vitest";
import { auth } from "../../../src/lib/auth.js";

/**
 * Stubs the session lookup for an id that exists in the test database. Requests
 * still run the real middleware, guards and services.
 */
export function signInAs(userId: string, options: { role?: string } = {}) {
	vi.mocked(auth.api.getSession).mockResolvedValue({
		session: {
			id: `session-${userId}`,
			userId,
			token: `token-${userId}`,
			expiresAt: new Date("2099-01-01"),
			createdAt: new Date("2026-01-01"),
			updatedAt: new Date("2026-01-01"),
			ipAddress: null,
			userAgent: null,
		},
		user: {
			id: userId,
			name: userId,
			email: `${userId}@vanlife.test`,
			emailVerified: false,
			image: null,
			createdAt: new Date("2026-01-01"),
			updatedAt: new Date("2026-01-01"),
			banned: false,
			role: options.role ?? null,
		},
	} as never);
}

export function signedOut() {
	vi.mocked(auth.api.getSession).mockResolvedValue(null);
}
