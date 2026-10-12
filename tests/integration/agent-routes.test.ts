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

const PATH = `${API_PREFIX}/agent/trip-planner/messages`;

function signIn() {
	vi.mocked(auth.api.getSession).mockResolvedValue({ user, session });
}

describe("POST /agent/trip-planner/messages", () => {
	it("rejects an empty message", async () => {
		// Arrange
		signIn();

		// Act
		const response = await app.request(PATH, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "" }),
		});

		// Assert
		expect(response.status).toBe(400);
	});

	it("rejects an unknown chat", async () => {
		// Arrange
		signIn();

		// Act
		const response = await app.request(PATH, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				message: "plan something",
				chatId: "no-such-chat",
			}),
		});

		// Assert
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			message: "Conversation not found.",
		});
	});

	it("refuses unauthenticated requests", async () => {
		// Arrange
		vi.mocked(auth.api.getSession).mockResolvedValue(null);

		// Act
		const response = await app.request(PATH, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "plan something" }),
		});

		// Assert
		expect(response.status).toBe(401);
	});

	it("reports 503 when the session cannot be looked up", async () => {
		// Arrange
		vi.mocked(auth.api.getSession).mockRejectedValue(new Error("db down"));

		// Act
		const response = await app.request(PATH, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "plan something" }),
		});

		// Assert
		expect(response.status).toBe(503);
	});
});

describe("Genkit protocol mount", () => {
	it("requires a signed-in traveller", async () => {
		// Arrange
		vi.mocked(auth.api.getSession).mockResolvedValue(null);

		// Act
		const response = await app.request(`${API_PREFIX}/ai/tripPlanner`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data: { message: "hi" }, init: {} }),
		});

		// Assert
		expect(response.status).toBe(401);
	});

	it("hands an authenticated request to the Genkit action", async () => {
		// Arrange
		signIn();

		// Act — an agent turn needs a message object; the reply below can only
		// come from Genkit's own validation, not the Hono route
		const response = await app.request(`${API_PREFIX}/ai/tripPlanner`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data: { message: "hi" }, init: {} }),
		});

		// Assert
		expect(response.status).toBe(400);
		expect((await response.json()).status).toBe("INVALID_ARGUMENT");
	});
});
