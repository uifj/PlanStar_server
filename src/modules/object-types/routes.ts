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
	CreateObjectTypeSchema,
	ObjectTypeListQuerySchema,
	ObjectTypeSchema,
	SpaceIdParamsSchema,
} from "./schema.js";

const tags = [OPENAPI_TAGS.TYPES];

export const listObjectTypesRoute = createRoute({
	method: "get",
	path: "/{spaceId}/object-types",
	tags,
	summary: "List types",
	description: "Returns the object types a space has registered.",
	request: {
		params: SpaceIdParamsSchema,
		query: ObjectTypeListQuerySchema,
	},
	responses: {
		...okResponse(
			"Types retrieved successfully.",
			createPaginatedResponseSchema(ObjectTypeSchema),
		),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("Space not found."),
	},
});

export const createObjectTypeRoute = createRoute({
	method: "post",
	path: "/{spaceId}/object-types",
	tags,
	summary: "Create type",
	description: "Registers a new object type and its recommended relations.",
	request: {
		params: SpaceIdParamsSchema,
		...requestBody(CreateObjectTypeSchema),
	},
	responses: {
		...createdResponse("Type created successfully.", ObjectTypeSchema),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("Space not found."),
		409: errorResponse("That type key already exists in this space."),
	},
});
