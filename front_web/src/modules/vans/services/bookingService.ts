import { apiClient } from "@/shared/api/apiClient";
import { apiPaths } from "@/shared/api/endpoints";
import type { CreateBookingRequest, CreatedBooking } from "../types";

export async function createBooking(booking: CreateBookingRequest) {
	const response = await apiClient.post<CreatedBooking>(
		apiPaths.bookings.list,
		booking,
	);

	return response.data;
}
