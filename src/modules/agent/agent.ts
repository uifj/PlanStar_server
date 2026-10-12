import type { ModelArgument } from "genkit";
import type { GenkitBeta, SessionStore } from "genkit/beta";
import { env } from "../../config/env.js";
import { ai } from "../../lib/genkit.js";
import { TRIP_PLANNER_AGENT_NAME } from "./constants.js";
import { PrismaAgentChatStore } from "./session-store.js";
import { createAgentTools } from "./tools.js";

const SYSTEM_PROMPT = `You plan van trips for a renter on VanLife.

Use the tools instead of guessing:
- searchVans for what is on offer
- checkAvailability before recommending specific dates
- myUpcomingTrips when the renter asks about their own trips

Prices, locations and availability always come from tool output, never from
imagination. If the request is missing a place, a date range or a budget, ask
for the smallest useful detail rather than assuming one. Answer in two or three
short sentences and name the van you mean.`;

export function createTripPlannerAgent(
	ai: GenkitBeta,
	options: { model: ModelArgument; store?: SessionStore },
) {
	const { checkAvailabilityTool, myUpcomingTripsTool, searchVansTool } =
		createAgentTools(ai);

	return ai.defineAgent({
		name: TRIP_PLANNER_AGENT_NAME,
		system: SYSTEM_PROMPT,
		tools: [searchVansTool, checkAvailabilityTool, myUpcomingTripsTool],
		model: options.model,
		...(options.store ? { store: options.store } : {}),
	});
}

export const tripPlannerAgent = createTripPlannerAgent(ai, {
	model: env.AGENT_MODEL,
	store: new PrismaAgentChatStore(),
});
