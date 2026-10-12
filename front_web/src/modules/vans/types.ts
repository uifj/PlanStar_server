import type { Booking } from "@/shared/domain/bookings/types";

export interface CreateBookingRequest {
	vanId: string;
	startDate: string;
	endDate: string;
	guests: number;
}

export type CreatedBooking = Booking;
