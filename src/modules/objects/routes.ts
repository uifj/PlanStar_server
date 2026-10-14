import { createRoute } from "@hono/zod-openapi";
import { requestBody } from "../../openapi/requests.js";
import {
	createdResponse,
	errorResponse,
	forbiddenResponse,
	noContentResponse,
	notFoundResponse,
	okResponse,
	unauthorizedResponse,
} from "../../openapi/responses.js";
import { OPENAPI_TAGS } from "../../openapi/tags.js";
import { createPaginatedResponseSchema } from "../../pagination/response.js";
import {
	BacklinkListQuerySchema,
	CreateObjectSchema,
	ObjectListQuerySchema,
	ObjectParamsSchema,
	ObjectSchema,
	SpaceIdParamsSchema,
	UpdateObjectSchema,
} from "./schema.js";

const tags = [OPENAPI_TAGS.OBJECTS];

const invalidFilters = {
	422: errorResponse("A filter used an unknown relation or operator."),
};

export const listObjectsRoute = createRoute({
	method: "get",
	path: "/{spaceId}/objects",
	tags,
	summary: "List objects",
	description:
		"Returns a paginated list of objects in the space, filtered through the space's relation registry.",
	request: {
		params: SpaceIdParamsSchema,
		query: ObjectListQuerySchema,
	},
	responses: {
		...okResponse(
			"Objects retrieved successfully.",
			createPaginatedResponseSchema(ObjectSchema),
		),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("Space not found."),
		...invalidFilters,
	},
});

export const createObjectRoute = createRoute({
	method: "post",
	path: "/{spaceId}/objects",
	tags,
	summary: "Create object",
	description: "Creates an object in the space.",
	request: {
		params: SpaceIdParamsSchema,
		...requestBody(CreateObjectSchema),
	},
	responses: {
		...createdResponse("Object created successfully.", ObjectSchema),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("Space or type not found."),
		...invalidFilters,
	},
});

export const getObjectRoute = createRoute({
	method: "get",
	path: "/{objectId}",
	tags,
	summary: "Get object",
	description:
		"Returns one object the caller's space membership allows reading.",
	request: {
		params: ObjectParamsSchema,
	},
	responses: {
		...okResponse("Object retrieved successfully.", ObjectSchema),
		...unauthorizedResponse,
		...notFoundResponse("Object not found."),
	},
});

export const updateObjectRoute = createRoute({
	method: "patch",
	path: "/{objectId}",
	tags,
	summary: "Update object",
	description:
		"Updates the object's fields and merges its details map; a null detail value clears the relation.",
	request: {
		params: ObjectParamsSchema,
		...requestBody(UpdateObjectSchema),
	},
	responses: {
		...okResponse("Object updated successfully.", ObjectSchema),
		...unauthorizedResponse,
		...notFoundResponse("Object not found."),
		...invalidFilters,
	},
});

export const listBacklinksRoute = createRoute({
	method: "get",
	path: "/{objectId}/backlinks",
	tags,
	summary: "List backlinks",
	description:
		"Returns the objects in the same space that link to this object, ordered by the link index.",
	request: {
		params: ObjectParamsSchema,
		query: BacklinkListQuerySchema,
	},
	responses: {
		...okResponse(
			"Backlinks retrieved successfully.",
			createPaginatedResponseSchema(ObjectSchema),
		),
		...unauthorizedResponse,
		...notFoundResponse("Object not found."),
	},
});

export const archiveObjectRoute = createRoute({
	method: "delete",
	path: "/{objectId}",
	tags,
	summary: "Archive object",
	description: "Moves the object to the space archive.",
	request: {
		params: ObjectParamsSchema,
	},
	responses: {
		...noContentResponse("Object archived."),
		...unauthorizedResponse,
		...notFoundResponse("Object not found."),
	},
});
