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
	AddSpaceParticipantSchema,
	CreateSpaceSchema,
	SpaceListQuerySchema,
	SpaceParamsSchema,
	SpaceParticipantParamsSchema,
	SpaceParticipantSchema,
	SpaceSchema,
	UpdateSpaceParticipantSchema,
} from "./schema.js";

const tags = [OPENAPI_TAGS.SPACES];

export const createSpaceRoute = createRoute({
	method: "post",
	path: "/",
	tags,
	summary: "Create space",
	description: "Creates a space the caller owns.",
	request: {
		...requestBody(CreateSpaceSchema),
	},
	responses: {
		...createdResponse("Space created successfully.", SpaceSchema),
		...unauthorizedResponse,
	},
});

export const listSpacesRoute = createRoute({
	method: "get",
	path: "/",
	tags,
	summary: "List spaces",
	description: "Returns a paginated list of spaces the caller belongs to.",
	request: {
		query: SpaceListQuerySchema,
	},
	responses: {
		...okResponse(
			"Spaces retrieved successfully.",
			createPaginatedResponseSchema(SpaceSchema),
		),
		...unauthorizedResponse,
	},
});

export const addSpaceParticipantRoute = createRoute({
	method: "post",
	path: "/{spaceId}/participants",
	tags,
	summary: "Add space participant",
	description: "Grants a user access to the space. Requires admin rights.",
	request: {
		params: SpaceParamsSchema,
		...requestBody(AddSpaceParticipantSchema),
	},
	responses: {
		...createdResponse(
			"Participant added successfully.",
			SpaceParticipantSchema,
		),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("Space not found."),
		409: errorResponse("That user already has access to this space."),
	},
});

export const updateSpaceParticipantRoute = createRoute({
	method: "patch",
	path: "/{spaceId}/participants/{participantId}",
	tags,
	summary: "Update space participant",
	description: "Changes a member's permission. Requires admin rights.",
	request: {
		params: SpaceParticipantParamsSchema,
		...requestBody(UpdateSpaceParticipantSchema),
	},
	responses: {
		...okResponse("Participant updated successfully.", SpaceParticipantSchema),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("Participant not found."),
	},
});
