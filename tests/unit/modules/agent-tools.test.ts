import { genkit } from "genkit/beta";
import { mockModel } from "genkit/testing";
import { describe, expect, it } from "vitest";
import { createAgentTools } from "../../../src/modules/agent/tools.js";
import { vanFixture } from "../../helpers/fixtures/vans.js";
import { prismaMock } from "../../mocks/prismaMock.js";

describe("trip planner tools", () => {
	it("lists vans matching the requested location and budget", async () => {
		// Arrange
		const ai = genkit({});
		const { searchVansTool } = createAgentTools(ai);
		prismaMock.van.findMany.mockResolvedValue([vanFixture()]);

		// Act
		const result = await searchVansTool({
			location: "Moab",
			maxPrice: 150,
			limit: 5,
		});

		// Assert
		expect(result.vans).toEqual([
			{
				id: "van-1",
				name: "Moab Trailhouse",
				price: 129,
				location: "Moab, UT",
				sleeps: 2,
				type: "rugged",
				rating: 4.5,
			},
		]);
	});

	it("marks a van as taken while an active booking overlaps the dates", async () => {
		// Arrange
		const ai = genkit({});
		const { checkAvailabilityTool } = createAgentTools(ai);
		prismaMock.van.findFirst.mockResolvedValue(vanFixture());
		prismaMock.booking.findFirst.mockResolvedValue({
			id: "booking-1",
			startDate: new Date("2026-09-03T00:00:00.000Z"),
			endDate: new Date("2026-09-08T00:00:00.000Z"),
		});

		// Act
		const result = await checkAvailabilityTool({
			vanId: "van-1",
			startDate: "2026-09-01",
			endDate: "2026-09-05",
		});

		// Assert
		expect(result.available).toBe(false);
		expect(result.reason).toBe("date_taken");
		expect(result.conflict).toEqual({
			startDate: "2026-09-03",
			endDate: "2026-09-08",
		});
	});

	it("marks a van as unbookable once the host archives it", async () => {
		// Arrange
		const ai = genkit({});
		const { checkAvailabilityTool } = createAgentTools(ai);
		prismaMock.van.findFirst.mockResolvedValue(null);

		// Act
		const result = await checkAvailabilityTool({
			vanId: "van-archived",
			startDate: "2026-09-01",
			endDate: "2026-09-05",
		});

		// Assert
		expect(result).toEqual({
			available: false,
			reason: "not_listed",
			conflict: null,
		});
		expect(prismaMock.booking.findFirst).not.toHaveBeenCalled();
	});

	it("reads trips of the signed-in traveller only, even when the model names someone else", async () => {
		// Arrange
		const ai = genkit({});
		const { myUpcomingTripsTool } = createAgentTools(ai);
		const model = mockModel(ai, {
			name: "plannerModel",
			info: { supports: { tools: true } },
			respond: [
				{
					toolRequests: [
						{
							name: "myUpcomingTrips",
							ref: "t1",
							input: { userId: "u-victim" },
						},
					],
				},
				{ text: "Here is what you have booked." },
			],
		});
		const agent = ai.defineAgent({
			name: "tripPlannerProbe",
			system: "Plan trips.",
			tools: [myUpcomingTripsTool],
			model,
		});
		prismaMock.agentChat.findUnique.mockResolvedValue({
			id: "chat-1",
			userId: "u-owner",
		});
		prismaMock.booking.findMany.mockResolvedValue([
			{
				id: "booking-1",
				startDate: new Date("2026-12-01T00:00:00.000Z"),
				endDate: new Date("2026-12-05T00:00:00.000Z"),
				status: "confirmed",
				van: { name: "Sierra Weekender" },
			},
		]);

		// Act
		const chat = agent.chat();
		const response = await chat.send("what do I have booked?");

		// Assert
		expect(prismaMock.agentChat.findUnique).toHaveBeenCalledWith({
			where: { id: chat.sessionId },
		});
		expect(prismaMock.booking.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ userId: "u-owner" }),
			}),
		);
		expect(model.toolResponses).toEqual([
			{
				name: "myUpcomingTrips",
				ref: "t1",
				output: {
					trips: [
						{
							id: "booking-1",
							vanName: "Sierra Weekender",
							startDate: "2026-12-01",
							endDate: "2026-12-05",
							status: "confirmed",
						},
					],
				},
			},
		]);
		expect(response.text).toBe("Here is what you have booked.");
	});
});
