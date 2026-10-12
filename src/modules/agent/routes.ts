import { createRoute } from "@hono/zod-openapi";
import { requestBody } from "../../openapi/requests.js";
import {
	notFoundResponse,
	okResponse,
	serviceUnavailableResponse,
	unauthorizedResponse,
} from "../../openapi/responses.js";
import { OPENAPI_TAGS } from "../../openapi/tags.js";
import { TripPlannerMessageSchema, TripPlannerReplySchema } from "./schema.js";

const tags = [OPENAPI_TAGS.AGENT];

export const sendTripPlannerMessageRoute = createRoute({
	method: "post",
	path: "/trip-planner/messages",
	tags,
	summary: "Send a trip planner message",
	description:
		"Sends one message to the trip planner agent and returns its reply. Omit chatId to start a new conversation.",
	request: {
		...requestBody(TripPlannerMessageSchema),
	},
	responses: {
		...okResponse("Trip planner replied.", TripPlannerReplySchema),
		...unauthorizedResponse,
		...notFoundResponse("Conversation not found."),
		...serviceUnavailableResponse(
			"The trip planner is temporarily unavailable.",
		),
	},
});
