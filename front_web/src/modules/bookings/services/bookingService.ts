import { apiClient } from "@/shared/api/apiClient";
import { apiPaths } from "@/shared/api/endpoints";
import type { Booking } from "@/shared/domain/bookings/types";
import type {
	CreateReviewRequest,
	RenterBookingsQueryParams,
	RenterBookingsResponse,
	Review,
} from "../types";

export async function getBookings(params: RenterBookingsQueryParams = {}) {
	const response = await apiClient.get<RenterBookingsResponse>(
		apiPaths.bookings.list,
		{
			params,
		},
	);

	return response.data;
}

export async function cancelBooking(id: string) {
	const response = await apiClient.post<Booking>(apiPaths.bookings.cancel(id));

	return response.data;
}

export async function createReview(review: CreateReviewRequest) {
	const response = await apiClient.post<Review>(
		apiPaths.bookings.reviews,
		review,
	);

	return response.data;
}
