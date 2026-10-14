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
import {
	BlockIdParamsSchema,
	BlockListResponseSchema,
	BlockSchema,
	CreateBlockSchema,
	ObjectIdParamsSchema,
	UpdateBlockSchema,
} from "./schema.js";

const tags = [OPENAPI_TAGS.BLOCKS];

export const listBlocksRoute = createRoute({
	method: "get",
	path: "/{objectId}/blocks",
	tags,
	summary: "Read document blocks",
	description:
		"Returns a page's body as one flat list ordered by the server-minted index; children are assembled from parentId by the client (ADR-0013).",
	request: {
		params: ObjectIdParamsSchema,
	},
	responses: {
		...okResponse("Document retrieved successfully.", BlockListResponseSchema),
		...unauthorizedResponse,
		...notFoundResponse("Object not found."),
	},
});

export const createBlockRoute = createRoute({
	method: "post",
	path: "/{objectId}/blocks",
	tags,
	summary: "Add block",
	description:
		"Appends a block to the document, or places it after the block named by afterBlockId. The index is always minted by the server.",
	request: {
		params: ObjectIdParamsSchema,
		...requestBody(CreateBlockSchema),
	},
	responses: {
		...createdResponse("Block added successfully.", BlockSchema),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("Object not found."),
		422: errorResponse("The block or its anchor is not usable."),
	},
});

export const updateBlockRoute = createRoute({
	method: "patch",
	path: "/{blockId}",
	tags,
	summary: "Update block",
	description:
		"Edits a block's text or style, and moves it when afterBlockId is given: null sends it to the front of the list, a block id places it after that sibling.",
	request: {
		params: BlockIdParamsSchema,
		...requestBody(UpdateBlockSchema),
	},
	responses: {
		...okResponse("Block updated successfully.", BlockSchema),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("Block not found."),
		422: errorResponse("The anchor block is not usable."),
	},
});

export const deleteBlockRoute = createRoute({
	method: "delete",
	path: "/{blockId}",
	tags,
	summary: "Delete block",
	description:
		"Removes a block and any blocks nested under it, and refreshes the page's link edges.",
	request: {
		params: BlockIdParamsSchema,
	},
	responses: {
		...noContentResponse("Block deleted."),
		...unauthorizedResponse,
		...notFoundResponse("Block not found."),
	},
});
