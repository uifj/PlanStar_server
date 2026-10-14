import { describe, expect, it, vi } from "vitest";
import { API_PREFIX } from "../../src/config/constants.js";
import { signInAs } from "./helpers/auth-session.js";
import { postRaw } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
		handler: vi.fn(),
	},
}));

describe("request bodies", () => {
	it("answers 400 when the JSON body cannot be parsed", async () => {
		// Arrange — signed in, so the body is what fails rather than the session
		signInAs("user-1");

		// Act
		const response = await postRaw(`${API_PREFIX}/spaces`, '{ "name": ');

		// Assert — a malformed body is the caller's fault, not a server fault
		expect(response.status).toBe(400);
		expect(((await response.json()) as { message: string }).message).toContain(
			"JSON",
		);
	});
});
