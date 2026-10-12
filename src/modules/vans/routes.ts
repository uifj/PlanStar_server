import { createRoute } from "@hono/zod-openapi";
import { notFoundResponse, okResponse } from "../../openapi/responses.js";
import { OPENAPI_TAGS } from "../../openapi/tags.js";
import { createPaginatedResponseSchema } from "../../pagination/response.js";
import {
	VanListQuerySchema,
	VanParamsSchema,
	VanSchema,
	VanSummarySchema,
} from "./schema.js";

const tags = [OPENAPI_TAGS.VANS];

export const listVansRoute = createRoute({
	method: "get",
	path: "/",
	tags,
	summary: "List vans",
	description: "Returns a paginated list of public, non-archived vans.",
	request: {
		query: VanListQuerySchema,
	},
	responses: {
		...okResponse(
			"Vans retrieved successfully.",
			createPaginatedResponseSchema(VanSummarySchema),
		),
	},
});

export const getVanRoute = createRoute({
	method: "get",
	path: "/{id}",
	tags,
	summary: "Get van",
	description: "Returns one public, non-archived van.",
	request: {
		params: VanParamsSchema,
	},
	responses: {
		...okResponse("Van retrieved successfully.", VanSchema),
		...notFoundResponse("Van not found."),
	},
});
