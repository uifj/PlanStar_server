export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
type BookingSort = "startDate" | "createdAt" | "totalPrice";
type BookingOrder = "asc" | "desc";
export type BookingSortChoice =
	| "newest"
	| "oldest"
	| "soonest-trip"
	| "latest-trip"
	| "highest-total"
	| "lowest-total";

export interface BookingsQueryParams {
	status?: BookingStatus;
	page?: number;
	limit?: number;
	sort?: BookingSort;
	order?: BookingOrder;
}

export interface Booking {
	id: string;
	startDate: string;
	endDate: string;
	guests: number;
	totalPrice: number;
	status: BookingStatus;
	createdAt: string;
}
