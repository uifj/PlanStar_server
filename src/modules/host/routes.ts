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
	CreateHostVanSchema,
	HostBookingListQuerySchema,
	HostBookingParamsSchema,
	HostBookingSchema,
	HostDashboardResponseSchema,
	HostIncomeResponseSchema,
	HostReviewsResponseSchema,
	HostStatsQuerySchema,
	HostVanListQuerySchema,
	HostVanParamsSchema,
	HostVanResponseSchema,
	HostVansResponseSchema,
	UpdateHostBookingStatusSchema,
	UpdateHostVanSchema,
} from "./schema.js";

const tags = [OPENAPI_TAGS.HOST];
const hostErrors = {
	...unauthorizedResponse,
	...forbiddenResponse,
};

export const listHostVansRoute = createRoute({
	method: "get",
	path: "/vans",
	tags,
	summary: "List host vans",
	description: "Returns vans owned by the current host.",
	request: {
		query: HostVanListQuerySchema,
	},
	responses: {
		...okResponse("Host vans retrieved successfully.", HostVansResponseSchema),
		...hostErrors,
	},
});

export const getHostVanRoute = createRoute({
	method: "get",
	path: "/vans/{id}",
	tags,
	summary: "Get host van",
	description: "Returns one van owned by the current host.",
	request: {
		params: HostVanParamsSchema,
	},
	responses: {
		...okResponse("Host van retrieved successfully.", HostVanResponseSchema),
		...hostErrors,
		...notFoundResponse("Van not found."),
	},
});

export const createHostVanRoute = createRoute({
	method: "post",
	path: "/vans",
	tags,
	summary: "Create host van",
	description: "Creates a van owned by the current host.",
	request: {
		...requestBody(CreateHostVanSchema),
	},
	responses: {
		...createdResponse("Host van created successfully.", HostVanResponseSchema),
		...hostErrors,
	},
});

export const updateHostVanRoute = createRoute({
	method: "patch",
	path: "/vans/{id}",
	tags,
	summary: "Update host van",
	description: "Updates a van owned by the current host.",
	request: {
		params: HostVanParamsSchema,
		...requestBody(UpdateHostVanSchema),
	},
	responses: {
		...okResponse("Host van updated successfully.", HostVanResponseSchema),
		...hostErrors,
		...notFoundResponse("Van not found."),
	},
});

export const deleteHostVanRoute = createRoute({
	method: "delete",
	path: "/vans/{id}",
	tags,
	summary: "Delete host van",
	description: "Archives a van owned by the current host.",
	request: {
		params: HostVanParamsSchema,
	},
	responses: {
		...noContentResponse("Host van deleted successfully."),
		...hostErrors,
		...notFoundResponse("Van not found."),
	},
});

export const getHostDashboardRoute = createRoute({
	method: "get",
	path: "/dashboard",
	tags,
	summary: "Get host dashboard",
	description: "Returns summary metrics for the current host.",
	request: {
		query: HostStatsQuerySchema,
	},
	responses: {
		...okResponse(
			"Host dashboard retrieved successfully.",
			HostDashboardResponseSchema,
		),
		...hostErrors,
	},
});

export const getHostIncomeRoute = createRoute({
	method: "get",
	path: "/income",
	tags,
	summary: "Get host income",
	description: "Returns income data for the current host.",
	request: {
		query: HostStatsQuerySchema,
	},
	responses: {
		...okResponse(
			"Host income retrieved successfully.",
			HostIncomeResponseSchema,
		),
		...hostErrors,
	},
});

export const getHostReviewsRoute = createRoute({
	method: "get",
	path: "/reviews",
	tags,
	summary: "Get host reviews",
	description: "Returns review summary and reviews for the current host.",
	request: {
		query: HostStatsQuerySchema,
	},
	responses: {
		...okResponse(
			"Host reviews retrieved successfully.",
			HostReviewsResponseSchema,
		),
		...hostErrors,
	},
});

export const listHostBookingsRoute = createRoute({
	method: "get",
	path: "/bookings",
	tags,
	summary: "List host bookings",
	description: "Returns paginated bookings for vans owned by the current host.",
	request: {
		query: HostBookingListQuerySchema,
	},
	responses: {
		...okResponse(
			"Host bookings retrieved successfully.",
			createPaginatedResponseSchema(HostBookingSchema),
		),
		...hostErrors,
	},
});

export const updateHostBookingStatusRoute = createRoute({
	method: "patch",
	path: "/bookings/{id}/status",
	tags,
	summary: "Update host booking status",
	description: "Updates the status of a booking for a van owned by the host.",
	request: {
		params: HostBookingParamsSchema,
		...requestBody(UpdateHostBookingStatusSchema),
	},
	responses: {
		...okResponse("Host booking updated successfully.", HostBookingSchema),
		400: errorResponse("Invalid booking status."),
		...hostErrors,
		...notFoundResponse("Booking not found."),
		409: errorResponse("Booking status conflict."),
	},
});
