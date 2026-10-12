import { createRoute } from "@hono/zod-openapi";
import {
	okResponse,
	serviceUnavailableResponse,
	unauthorizedResponse,
} from "../../openapi/responses.js";
import { OPENAPI_TAGS } from "../../openapi/tags.js";
import * as schema from "./schema.js";

export const currentUserRoute = createRoute({
	method: "get",
	path: "/",
	tags: [OPENAPI_TAGS.USER],
	summary: "Current user",
	description: "Returns the currently authenticated user.",
	responses: {
		...okResponse("Current user", schema.CurrentUserResponseSchema),
		...unauthorizedResponse,
		...serviceUnavailableResponse("Authentication service unavailable."),
	},
});
