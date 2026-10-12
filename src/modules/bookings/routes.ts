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
	BookingListItemSchema,
	BookingListQuerySchema,
	BookingParamsSchema,
	BookingSchema,
	CreateBookingSchema,
} from "./schema.js";

const tags = [OPENAPI_TAGS.BOOKINGS];

export const listBookingsRoute = createRoute({
	method: "get",
	path: "/",
	tags,
	summary: "List bookings",
	description:
		"Returns a paginated list of bookings owned by the current user.",
	request: {
		query: BookingListQuerySchema,
	},
	responses: {
		...okResponse(
			"Bookings retrieved successfully.",
			createPaginatedResponseSchema(BookingListItemSchema),
		),
		...unauthorizedResponse,
	},
});

export const createBookingRoute = createRoute({
	method: "post",
	path: "/",
	tags,
	summary: "Create booking",
	description: "Creates a booking for the current user.",
	request: {
		...requestBody(CreateBookingSchema),
	},
	responses: {
		...createdResponse("Booking created successfully.", BookingSchema),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("Van not found."),
		409: errorResponse("Requested dates overlap an existing booking."),
	},
});

export const cancelBookingRoute = createRoute({
	method: "post",
	path: "/{id}/cancel",
	tags,
	summary: "Cancel booking",
	description: "Cancels a booking owned by the current renter.",
	request: {
		params: BookingParamsSchema,
	},
	responses: {
		...okResponse("Booking cancelled successfully.", BookingSchema),
		...unauthorizedResponse,
		...forbiddenResponse,
		...notFoundResponse("Booking not found."),
		400: errorResponse("Booking cannot be cancelled."),
	},
});
