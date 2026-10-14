import { createRoute } from "@hono/zod-openapi";
import { requestBody } from "../../openapi/requests.js";
import {
	createdResponse,
	errorResponse,
	forbiddenResponse,
	notFoundResponse,
	okResponse,
	unauthorizedResponse,
} from "../../openapi/responses.js";
import { OPENAPI_TAGS } from "../../openapi/tags.js";
import { ObjectSchema } from "../objects/schema.js";
import {
	CreateDataviewSchema,
	DataviewCreateParamsSchema,
	DataviewParamsSchema,
	DataviewRecordsQuerySchema,
	DataviewRecordsResponseSchema,
} from "./schema.js";

const tags = [OPENAPI_TAGS.DATAVIEWS];

export const createDataviewRoute = createRoute({
	method: "post",
	path: "/{spaceId}/dataviews",
	tags,
	summary: "Create saved view",
	description:
		"Saves a view of a space's objects. A view is itself an object with the dataview layout, so it lists with the other objects.",
	request: {
		params: DataviewCreateParamsSchema,
		...requestBody(CreateDataviewSchema),
	},
	responses: {
		...createdResponse("View created successfully.", ObjectSchema),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("Space or type not found."),
		422: errorResponse("A filter or sort used an unknown relation."),
	},
});

export const listDataviewRecordsRoute = createRoute({
	method: "get",
	path: "/{spaceId}/dataviews/{dataviewId}/records",
	tags,
	summary: "List view records",
	description:
		"Runs the view's stored filters and sorts over its source type, with the matched and total counters.",
	request: {
		params: DataviewParamsSchema,
		query: DataviewRecordsQuerySchema,
	},
	responses: {
		...okResponse(
			"View records retrieved successfully.",
			DataviewRecordsResponseSchema,
		),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("View not found."),
		422: errorResponse("The stored view no longer compiles."),
	},
});
