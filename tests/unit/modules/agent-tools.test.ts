import { genkit } from "genkit/beta";
import { mockModel } from "genkit/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../src/lib/auth.js";
import { agentSessionService } from "../../../src/modules/agent/actor.js";
import { createAgentTools } from "../../../src/modules/agent/tools.js";
import { bookingService } from "../../../src/modules/bookings/service.js";
import type { CatalogVan } from "../../../src/modules/vanlife/catalog.js";
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

vi.mock("../../../src/modules/bookings/service.js", () => ({
	bookingService: {
		findUpcoming: vi.fn(),
		findConflictingBooking: vi.fn(),
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

const moabVan: CatalogVan = {
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
};

// A tool only sees a session, so every case runs the tool inside one. The tool
// and the agent must come from the same genkit instance to be findable.
async function askOnce(
	ai: ReturnType<typeof genkit>,
	toolName: string,
	tool: unknown,
	input: Record<string, unknown>,
) {
	const model = mockModel(ai, {
		name: `${toolName}Model`,
		info: { supports: { tools: true } },
		respond: [
			{ toolRequests: [{ name: toolName, ref: "t1", input }] },
			{ text: `answered ${toolName}` },
		],
	});
	const agent = ai.defineAgent({
		name: `${toolName}Probe`,
		tools: [tool as never],
		model,
	});
	const chat = agent.chat();

	await chat.send("plan something");

	return { model, sessionId: chat.sessionId };
}

describe("trip planner tools", () => {
	beforeEach(() => {
		vi.mocked(agentSessionService.findSession).mockResolvedValue({
			actor: renter,
			spaceId: "vanlife-space",
		});
	});

	it("searches the catalog for the traveller of this conversation", async () => {
		// Arrange
		const ai = genkit({});
		const { searchVansTool } = createAgentTools(ai);
		vi.mocked(vanLifeService.searchListedVans).mockResolvedValue([moabVan]);

		// Act
		const { model, sessionId } = await askOnce(
			ai,
			"searchVans",
			searchVansTool,
			{ location: "moab", maxPrice: 150, limit: 5 },
		);

		// Assert — the conversation decides who asks, the service decides what matches
		expect(agentSessionService.findSession).toHaveBeenCalledWith(sessionId);
		expect(vanLifeService.searchListedVans).toHaveBeenCalledWith(
			renter,
			"vanlife-space",
			{ location: "moab", maxPrice: 150, limit: 5 },
		);
		expect(model.toolResponses).toEqual([
			{
				name: "searchVans",
				ref: "t1",
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

	it("names the booking that blocks the dates the planner wants", async () => {
		// Arrange
		const ai = genkit({});
		const { checkAvailabilityTool } = createAgentTools(ai);
		vi.mocked(vanLifeService.findListedVan).mockResolvedValue(moabVan);
		vi.mocked(bookingService.findConflictingBooking).mockResolvedValue({
			startDate: "2026-09-03",
			endDate: "2026-09-08",
		});

		// Act
		const { model } = await askOnce(
			ai,
			"checkAvailability",
			checkAvailabilityTool,
			{ vanId: "van-1", startDate: "2026-09-01", endDate: "2026-09-05" },
		);

		// Assert
		expect(vanLifeService.findListedVan).toHaveBeenCalledWith(
			renter,
			"vanlife-space",
			"van-1",
		);
		expect(model.toolResponses?.[0]?.output).toEqual({
			available: false,
			reason: "date_taken",
			conflict: { startDate: "2026-09-03", endDate: "2026-09-08" },
		});
	});

	it("marks a retired van as unbookable without asking about dates", async () => {
		// Arrange
		const ai = genkit({});
		const { checkAvailabilityTool } = createAgentTools(ai);
		vi.mocked(vanLifeService.findListedVan).mockResolvedValue(undefined);

		// Act
		const { model } = await askOnce(
			ai,
			"checkAvailability",
			checkAvailabilityTool,
			{ vanId: "van-archived", startDate: "2026-09-01", endDate: "2026-09-05" },
		);

		// Assert
		expect(model.toolResponses?.[0]?.output).toEqual({
			available: false,
			reason: "not_listed",
			conflict: null,
		});
		expect(bookingService.findConflictingBooking).not.toHaveBeenCalled();
	});

	it("lists the trips of the traveller in the conversation, not the one the model named", async () => {
		// Arrange
		const ai = genkit({});
		const { myUpcomingTripsTool } = createAgentTools(ai);
		vi.mocked(bookingService.findUpcoming).mockResolvedValue([
			{
				id: "booking-1",
				startDate: "2026-12-01",
				endDate: "2026-12-05",
				guests: 2,
				totalPrice: 516,
				status: "confirmed",
				createdAt: "2026-10-01T00:00:00.000Z",
				review: null,
				van: {
					id: "van-1",
					name: "Sierra Weekender",
					imageUrl: "https://images.example.test/sierra.jpg",
					type: "simple",
					location: "Mammoth Lakes, CA",
				},
			},
		]);

		// Act — the model tries to point at someone else
		const intruding = await askOnce(
			ai,
			"myUpcomingTrips",
			myUpcomingTripsTool,
			{ userId: "u-victim" },
		);

		// Assert
		expect(bookingService.findUpcoming).toHaveBeenCalledExactlyOnceWith(renter);
		expect(intruding.model.toolResponses?.[0]?.output).toEqual({
			trips: [
				{
					id: "booking-1",
					vanName: "Sierra Weekender",
					startDate: "2026-12-01",
					endDate: "2026-12-05",
					status: "confirmed",
				},
			],
		});
	});

	it("refuses to plan for a conversation that is linked to nobody", async () => {
		// Arrange
		vi.mocked(agentSessionService.findSession).mockResolvedValue(undefined);
		const ai = genkit({});
		const { searchVansTool } = createAgentTools(ai);

		// Act
		const attempt = askOnce(ai, "searchVans", searchVansTool, { limit: 5 });

		// Assert
		await expect(attempt).rejects.toThrow(/not linked to a traveller/);
		expect(vanLifeService.searchListedVans).not.toHaveBeenCalled();
	});
});
