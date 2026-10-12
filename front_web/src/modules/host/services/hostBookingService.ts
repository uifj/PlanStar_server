import { apiClient } from "@/shared/api/apiClient";
import { apiPaths } from "@/shared/api/endpoints";
import type {
	HostBooking,
	HostBookingsQueryParams,
	HostBookingsResponse,
	UpdateHostBookingStatusRequest,
} from "../types";

export async function getHostBookings(params: HostBookingsQueryParams = {}) {
	const response = await apiClient.get<HostBookingsResponse>(
		apiPaths.host.bookings.list,
		{ params },
	);

	return response.data;
}

export async function updateHostBookingStatus({
	id,
	status,
}: UpdateHostBookingStatusRequest) {
	const response = await apiClient.patch<HostBooking>(
		apiPaths.host.bookings.updateStatus(id),
		{ status },
	);

	return response.data;
}
