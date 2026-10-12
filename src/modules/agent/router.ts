import { fetchHandler } from "@genkit-ai/fetch";
import { getCurrentUser } from "../../auth/current-user.js";
import { createProtectedRouter } from "../../auth/protected-router.js";
import { tripPlannerAgent } from "./agent.js";
import { TRIP_PLANNER_AGENT_NAME } from "./constants.js";
import { sendTripPlannerMessageRoute } from "./routes.js";
import { createAgentService } from "./service.js";

const agentService = createAgentService({ agent: tripPlannerAgent });

export const agentRouter = createProtectedRouter();

agentRouter.openapi(sendTripPlannerMessageRoute, async (c) => {
	const user = getCurrentUser(c);
	const { chatId, message } = c.req.valid("json");

	const reply = await agentService.respond({
		userId: user.id,
		chatId,
		message,
	});

	return c.json(reply);
});

/**
 * The same agent over Genkit's own wire format, which the browser
 * `remoteAgent` client and the Genkit Dev UI speak.
 */
export const agentProtocolRouter = createProtectedRouter();

const handleTripPlanner = fetchHandler(tripPlannerAgent);

agentProtocolRouter.all(`/${TRIP_PLANNER_AGENT_NAME}`, (c) =>
	handleTripPlanner(c.req.raw),
);
