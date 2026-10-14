import { googleAI } from "@genkit-ai/google-genai";
import { genkit } from "genkit/beta";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../src/lib/auth.js";
import { createTripPlannerAgent } from "../../../src/modules/agent/agent.js";
import { createAgentService } from "../../../src/modules/agent/service.js";
import { prismaMock } from "../../mocks/prismaMock.js";

vi.mock("../../../src/modules/vanlife/service.js", () => ({
	vanLifeService: {
		ensureVanLifeSpace: vi.fn().mockResolvedValue("vanlife-space"),
	},
}));

const renter = {
	id: "user-1",
	name: "Jamie Lee",
	email: "renter@vanlife.test",
	emailVerified: true,
	image: null,
	role: "user",
} as AuthUser;

describe("trip planner service", () => {
	it("reports the planner as unavailable when no model is configured", async () => {
		// Arrange — a real provider plugin with no API key in the test env
		const ai = genkit({
			plugins: [googleAI()],
			model: googleAI.model("gemini-flash-latest"),
		});
		const service = createAgentService({
			agent: createTripPlannerAgent(ai, {
				model: "googleai/gemini-flash-latest",
			}),
		});
		prismaMock.agentChat.create.mockResolvedValue({ id: "chat-1" });

		// Act
		const attempt = service.respond({
			actor: renter,
			message: "plan a trip",
		});

		// Assert
		await expect(attempt).rejects.toMatchObject({ statusCode: 503 });
	});
});
