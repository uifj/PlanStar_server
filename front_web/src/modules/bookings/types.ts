import type {
	Booking,
	BookingsQueryParams,
} from "@/shared/domain/bookings/types";
import type { VanType } from "@/shared/domain/vans/types";

interface RenterBookingVan {
	id: string;
	name: string;
	imageUrl: string;
	type: VanType;
	location: string;
}

interface BookingsMeta {
	page: number;
	limit: number;
	total: number;
	totalPages: number;
}

export interface BookingReview {
	id: string;
	rating: number;
	text: string;
	createdAt: string;
}

export interface RenterBooking extends Booking {
	review: BookingReview | null;
	van: RenterBookingVan;
}

export interface RenterBookingsResponse {
	data: RenterBooking[];
	meta: BookingsMeta;
}

export interface CreateReviewRequest {
	bookingId: string;
	rating: number;
	text: string;
}

export interface Review {
	id: string;
	bookingId: string;
	rating: number;
	text: string;
	createdAt: string;
}

export type RenterBookingsQueryParams = BookingsQueryParams;
