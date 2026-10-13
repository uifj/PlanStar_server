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
import { createPaginatedResponseSchema } from "../../pagination/response.js";
import {
	CreateRelationSchema,
	RelationListQuerySchema,
	RelationSchema,
	SpaceIdParamsSchema,
} from "./schema.js";

const tags = [OPENAPI_TAGS.RELATIONS];

export const listRelationsRoute = createRoute({
	method: "get",
	path: "/{spaceId}/relations",
	tags,
	summary: "List relations",
	description:
		"Returns the relations a space has registered, newest recommendations first.",
	request: {
		params: SpaceIdParamsSchema,
		query: RelationListQuerySchema,
	},
	responses: {
		...okResponse(
			"Relations retrieved successfully.",
			createPaginatedResponseSchema(RelationSchema),
		),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("Space not found."),
	},
});

export const createRelationRoute = createRoute({
	method: "post",
	path: "/{spaceId}/relations",
	tags,
	summary: "Create relation",
	description: "Registers a new relation key in the space.",
	request: {
		params: SpaceIdParamsSchema,
		...requestBody(CreateRelationSchema),
	},
	responses: {
		...createdResponse("Relation created successfully.", RelationSchema),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("Space not found."),
		409: errorResponse("That relation key already exists in this space."),
	},
});
