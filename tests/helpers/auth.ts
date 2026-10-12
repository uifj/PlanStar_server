import { vi } from "vitest";
import { auth } from "../../src/lib/auth.js";
import { session, user } from "./fixtures/auth.js";

export function mockAuthenticatedUser() {
	vi.spyOn(auth.api, "getSession").mockResolvedValue({
		user,
		session,
	});
}

export function mockUnauthenticatedUser() {
	vi.spyOn(auth.api, "getSession").mockResolvedValue(null);
}
