import { genkit } from "genkit/beta";
import { mockModel } from "genkit/testing";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../src/lib/auth.js";
import { agentSessionService } from "../../../src/modules/agent/actor.js";
import { createTripPlannerAgent } from "../../../src/modules/agent/agent.js";
import { vanLifeService } from "../../../src/modules/vanlife/service.js";

vi.mock("../../../src/modules/agent/actor.js", () => ({
	agentSessionService: {
		findSession: vi.fn(),
	},
}));

vi.mock("../../../src/modules/vanlife/service.js", () => ({
	vanLifeService: {
		searchListedVans: vi.fn(),
		findListedVan: vi.fn(),
	},
}));

const renter = {
	id: "u-owner",
	name: "Jamie Lee",
	email: "renter@vanlife.test",
	emailVerified: true,
	image: null,
	role: "user",
} as AuthUser;

describe("trip planner agent", () => {
	it("answers using live listing data from the search tool", async () => {
		// Arrange
		const ai = genkit({});
		const model = mockModel(ai, {
			name: "plannerModel",
			info: { supports: { tools: true } },
			respond: [
				{
					toolRequests: [
						{
							name: "searchVans",
							ref: "call-1",
							input: { location: "Moab" },
						},
					],
				},
				{ text: "The Moab Trailhouse fits that trip at $129 a night." },
			],
		});
		const agent = createTripPlannerAgent(ai, { model });
		vi.mocked(agentSessionService.findSession).mockResolvedValue({
			actor: renter,
			spaceId: "vanlife-space",
		});
		vi.mocked(vanLifeService.searchListedVans).mockResolvedValue([
			{
				id: "van-1",
				name: "Moab Trailhouse",
				price: 129,
				description: "A trailhouse for two.",
				imageUrl: "https://images.example.test/moab.jpg",
				type: "rugged",
				location: "Moab, UT",
				sleeps: 2,
				rating: 4.5,
				amenities: ["heater"],
			},
		]);

		// Act
		const response = await agent.chat().send("something rugged near Moab");

		// Assert
		expect(response.text).toBe(
			"The Moab Trailhouse fits that trip at $129 a night.",
		);
		expect(model.toolResponses).toEqual([
			{
				name: "searchVans",
				ref: "call-1",
				output: {
					vans: [
						{
							id: "van-1",
							name: "Moab Trailhouse",
							price: 129,
							location: "Moab, UT",
							sleeps: 2,
							type: "rugged",
							rating: 4.5,
						},
					],
				},
			},
		]);
	});

	it("keeps the conversation across turns in one chat", async () => {
		// Arrange
		const ai = genkit({});
		const model = mockModel(ai, {
			name: "plannerModel",
			respond: [{ text: "Noted." }, { text: "You asked twice." }],
		});
		const agent = createTripPlannerAgent(ai, { model });
		const chat = agent.chat();

		// Act
		const first = await chat.send("first message");
		const second = await chat.send("second message");

		// Assert
		expect(first.text).toBe("Noted.");
		expect(second.text).toBe("You asked twice.");
		expect(chat.sessionId).toBeDefined();
		const followUpMessages = model.requests[1]?.messages ?? [];
		const firstTurnMessages = model.requests[0]?.messages ?? [];
		expect(followUpMessages.length).toBeGreaterThan(firstTurnMessages.length);
		expect(JSON.stringify(followUpMessages)).toContain("first message");
	});
});
