import type {
	Booking,
	BookingStatus,
	BookingsQueryParams,
} from "@/shared/domain/bookings/types";
import type { Van } from "@/shared/domain/vans/types";

type HostStatVan = Pick<Van, "id" | "name" | "type">;

export interface Dashboard {
	days: number;
	income: number;
	bookingCount: number;
	averageReviewScore: number;
	reviewCount: number;
	listedVanCount: number;
}

export interface Income {
	days: number;
	total: number;
	periods: Period[];
	transactions: Transaction[];
}

export interface Period {
	period: string;
	income: number;
	bookingCount: number;
}

export interface Transaction {
	id: string;
	amount: number;
	date: string;
	van: HostStatVan;
}

export interface Reviews {
	days: number;
	overallRating: number;
	ratingDistribution: RatingDistribution[];
	reviews: HostReview[];
}

export interface RatingDistribution {
	rating: number;
	count: number;
	percentage: number;
}

export interface HostReview {
	id: string;
	renterName: string;
	date: string;
	rating: number;
	text: string;
	van: HostStatVan;
}

export type HostBookingsQueryParams = BookingsQueryParams;

interface HostBookingVan {
	id: string;
	name: string;
	imageUrl: string;
	type: Van["type"];
}

interface HostBookingsMeta {
	page: number;
	limit: number;
	total: number;
	totalPages: number;
}

export interface HostBooking extends Booking {
	renter: {
		id: string;
		name: string;
	};
	van: HostBookingVan;
}

export interface HostBookingsResponse {
	data: HostBooking[];
	meta: HostBookingsMeta;
}

export interface UpdateHostBookingStatusRequest {
	id: string;
	status: Extract<BookingStatus, "confirmed" | "completed" | "cancelled">;
}

export interface CreateHostVanRequest {
	name: string;
	price: number;
	description: string;
	imageUrl: string;
	type: Van["type"];
	location: string;
	sleeps: number;
	amenities: string[];
}

export interface UpdateHostVanRequest extends Partial<CreateHostVanRequest> {
	id: string;
}
