import z from "zod";
import { SortOrderSchema } from "../../pagination/index.js";
import {
	BOOKING_SORT_FIELDS,
	DEFAULT_BOOKING_SORT_FIELD,
	DEFAULT_BOOKING_SORT_ORDER,
} from "../bookings/constants.js";
import { BookingStatusSchema } from "../bookings/schema.js";
import {
	DEFAULT_VAN_SORT_FIELD,
	DEFAULT_VAN_SORT_ORDER,
	VAN_SORT_FIELDS,
} from "../vans/constants.js";
import { VanSchema, VanSummarySchema, VanTypeSchema } from "../vans/schema.js";

export const HostVanListItemSchema = VanSummarySchema.meta({
	id: "HostVanListItem",
});

export const HostVansResponseSchema = z
	.object({
		data: z.array(HostVanListItemSchema),
	})
	.meta({ id: "HostVansResponse" });

export const HostVanResponseSchema = VanSchema;

export const HostVanParamsSchema = z.object({
	id: z.string(),
});

export const HostVanListQuerySchema = z
	.object({
		search: z.string().trim().optional(),
		sort: z.enum(VAN_SORT_FIELDS).default(DEFAULT_VAN_SORT_FIELD),
		order: SortOrderSchema.default(DEFAULT_VAN_SORT_ORDER),
	})
	.meta({ id: "HostVanListQuery" });

export const CreateHostVanSchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(1, "Van name is required.")
			.max(120, "Van name cannot exceed 120 characters."),
		price: z
			.number()
			.int("Price must be a whole number.")
			.positive("Price must be greater than 0."),
		description: z
			.string()
			.trim()
			.min(1, "Description is required.")
			.max(2000, "Description cannot exceed 2000 characters."),
		imageUrl: z.url("Enter a valid image URL."),
		type: VanTypeSchema,
		location: z
			.string()
			.trim()
			.min(1, "Location is required.")
			.max(160, "Location cannot exceed 160 characters."),
		sleeps: z
			.number()
			.int("Sleeps must be a whole number.")
			.positive("Sleeps must be greater than 0.")
			.max(12, "Sleeps cannot be more than 12."),
		amenities: z
			.array(
				z
					.string()
					.trim()
					.min(1, "Amenity cannot be empty.")
					.max(80, "Amenity cannot exceed 80 characters."),
			)
			.max(20, "Amenities cannot include more than 20 items.")
			.default([]),
	})
	.meta({ id: "CreateHostVan" });

export const UpdateHostVanSchema = CreateHostVanSchema.partial().meta({
	id: "UpdateHostVan",
});

const HostDashboardSchema = z
	.object({
		days: z.number(),
		income: z.number(),
		bookingCount: z.number(),
		averageReviewScore: z.number(),
		reviewCount: z.number(),
		listedVanCount: z.number(),
	})
	.meta({ id: "HostDashboard" });

export const HostDashboardResponseSchema = HostDashboardSchema;

const HostIncomePeriodSchema = z
	.object({
		period: z.string(),
		income: z.number(),
		bookingCount: z.number(),
	})
	.meta({ id: "HostIncomePeriod" });

const HostCompactVanSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		type: VanTypeSchema,
	})
	.meta({ id: "HostCompactVan" });

const HostBookingVanSchema = HostCompactVanSchema.extend({
	imageUrl: z.url(),
}).meta({ id: "HostBookingVan" });

const HostTransactionSchema = z
	.object({
		id: z.string(),
		amount: z.number(),
		date: z.iso.date(),
		van: HostCompactVanSchema,
	})
	.meta({ id: "HostTransaction" });

const HostIncomeSchema = z
	.object({
		days: z.number(),
		total: z.number(),
		periods: z.array(HostIncomePeriodSchema),
		transactions: z.array(HostTransactionSchema),
	})
	.meta({ id: "HostIncome" });

export const HostIncomeResponseSchema = HostIncomeSchema;

export const HostStatsQuerySchema = z
	.object({
		days: z.coerce
			.number()
			.int("Days must be a whole number.")
			.positive("Days must be greater than 0.")
			.max(365, "Days cannot be more than 365.")
			.default(30),
	})
	.meta({ id: "HostStatsQuery" });

const HostRatingDistributionSchema = z
	.object({
		rating: z.number(),
		count: z.number(),
		percentage: z.number(),
	})
	.meta({ id: "HostRatingDistribution" });

const HostReviewSchema = z
	.object({
		id: z.string(),
		renterName: z.string(),
		date: z.iso.date(),
		rating: z.number(),
		text: z.string(),
		van: HostCompactVanSchema,
	})
	.meta({ id: "HostReview" });

const HostReviewsSchema = z
	.object({
		days: z.number(),
		overallRating: z.number(),
		ratingDistribution: z.array(HostRatingDistributionSchema),
		reviews: z.array(HostReviewSchema),
	})
	.meta({ id: "HostReviews" });

export const HostReviewsResponseSchema = HostReviewsSchema;

const HostBookingRenterSchema = z
	.object({
		id: z.string(),
		name: z.string(),
	})
	.meta({ id: "HostBookingRenter" });

export const HostBookingSchema = z
	.object({
		id: z.string(),
		startDate: z.iso.date(),
		endDate: z.iso.date(),
		guests: z.number(),
		totalPrice: z.number(),
		status: BookingStatusSchema,
		createdAt: z.iso.datetime(),
		renter: HostBookingRenterSchema,
		van: HostBookingVanSchema,
	})
	.meta({ id: "HostBooking" });

export const HostBookingParamsSchema = z.object({
	id: z.string(),
});

export const HostBookingListQuerySchema = z
	.object({
		page: z.coerce
			.number()
			.int("Page must be a whole number.")
			.min(1, "Page must be at least 1.")
			.default(1),
		limit: z.coerce
			.number()
			.int("Limit must be a whole number.")
			.min(1, "Limit must be at least 1.")
			.max(50, "Limit cannot exceed 50.")
			.default(10),
		status: BookingStatusSchema.optional(),
		sort: z.enum(BOOKING_SORT_FIELDS).default(DEFAULT_BOOKING_SORT_FIELD),
		order: SortOrderSchema.default(DEFAULT_BOOKING_SORT_ORDER),
	})
	.meta({ id: "HostBookingListQuery" });

export const UpdateHostBookingStatusSchema = z
	.object({
		status: z.enum(["confirmed", "completed", "cancelled"]),
	})
	.meta({ id: "UpdateHostBookingStatus" });

export type CreateHostVan = z.infer<typeof CreateHostVanSchema>;
export type UpdateHostVan = z.infer<typeof UpdateHostVanSchema>;
export type HostVanListQuery = z.infer<typeof HostVanListQuerySchema>;
export type HostBookingListQuery = z.infer<typeof HostBookingListQuerySchema>;
export type HostStatsQuery = z.infer<typeof HostStatsQuerySchema>;
export type UpdateHostBookingStatus = z.infer<
	typeof UpdateHostBookingStatusSchema
>;
