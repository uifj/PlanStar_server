import { createRoute } from "@hono/zod-openapi";
import { requestBody } from "../../openapi/requests.js";
import { okResponse, unauthorizedResponse } from "../../openapi/responses.js";
import { OPENAPI_TAGS } from "../../openapi/tags.js";
import {
	CommandBodySchema,
	CommandNameParamsSchema,
	CommandResponseSchema,
} from "./schema.js";

export const commandRoute = createRoute({
	method: "post",
	path: "/{name}",
	tags: [OPENAPI_TAGS.OBJECTS],
	summary: "Run a client command",
	description:
		"Answers one Anytype ClientCommand over the session cookie, returning the " +
		"decoded-response envelope the vendored shell's dispatcher expects.",
	request: {
		params: CommandNameParamsSchema,
		...requestBody(CommandBodySchema, false),
	},
	responses: {
		...okResponse("Command result.", CommandResponseSchema),
		...unauthorizedResponse,
	},
});
