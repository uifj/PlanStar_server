import z from "zod";
import { ListQuerySchema, SortOrderSchema } from "../../pagination/index.js";
import {
	BOOKING_SORT_FIELDS,
	BOOKING_STATUSES,
	DEFAULT_BOOKING_SORT_FIELD,
	DEFAULT_BOOKING_SORT_ORDER,
} from "./constants.js";

export const BookingStatusSchema = z.enum(BOOKING_STATUSES);

const BookingVanSummarySchema = z
	.object({
		id: z.string(),
		name: z.string(),
		imageUrl: z.url(),
		type: z.enum(["simple", "luxury", "rugged"]),
		location: z.string(),
	})
	.meta({ id: "BookingVanSummary" });

const BookingReviewSchema = z
	.object({
		id: z.string(),
		rating: z.number(),
		text: z.string(),
		createdAt: z.iso.datetime(),
	})
	.meta({ id: "BookingReview" });

export const BookingSchema = z
	.object({
		id: z.string(),
		startDate: z.iso.date(),
		endDate: z.iso.date(),
		guests: z.number(),
		totalPrice: z.number(),
		status: BookingStatusSchema,
		createdAt: z.iso.datetime(),
	})
	.meta({ id: "Booking" });

export const BookingListItemSchema = BookingSchema.extend({
	review: BookingReviewSchema.nullable(),
	van: BookingVanSummarySchema,
}).meta({ id: "BookingListItem" });

export const CreateBookingSchema = z
	.object({
		vanId: z.string().trim().min(1, "Van is required."),
		startDate: z.iso.date(),
		endDate: z.iso.date(),
		guests: z
			.number()
			.int("Guests must be a whole number.")
			.min(1, "At least one guest is required."),
	})
	.meta({ id: "CreateBooking" });

export const BookingParamsSchema = z.object({
	id: z.string(),
});

export const BookingListQuerySchema = ListQuerySchema.extend({
	status: BookingStatusSchema.optional(),
	sort: z.enum(BOOKING_SORT_FIELDS).default(DEFAULT_BOOKING_SORT_FIELD),
	order: SortOrderSchema.default(DEFAULT_BOOKING_SORT_ORDER),
}).meta({ id: "BookingListQuery" });

export type CreateBooking = z.infer<typeof CreateBookingSchema>;
export type BookingListQuery = z.infer<typeof BookingListQuerySchema>;
