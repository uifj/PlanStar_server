import { createRoute } from "@hono/zod-openapi";
import { requestBody } from "../../openapi/requests.js";
import {
	createdResponse,
	forbiddenResponse,
	notFoundResponse,
	unauthorizedResponse,
} from "../../openapi/responses.js";
import { OPENAPI_TAGS } from "../../openapi/tags.js";
import { CreateReviewSchema, ReviewSchema } from "./schema.js";

const tags = [OPENAPI_TAGS.REVIEWS];

export const createReviewRoute = createRoute({
	method: "post",
	path: "/",
	tags,
	summary: "Create review",
	description:
		"Creates a review for a completed booking owned by the current user.",
	request: {
		...requestBody(CreateReviewSchema),
	},
	responses: {
		...createdResponse("Review created successfully.", ReviewSchema),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("Booking not found."),
	},
});
