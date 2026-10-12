import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { hostQueryKeys } from "../queryKeys";
import { getHostBookings } from "../services/hostBookingService";
import type { HostBookingsQueryParams } from "../types";

interface UseHostBookingsOptions {
	params?: HostBookingsQueryParams;
}

export function useHostBookings({ params = {} }: UseHostBookingsOptions = {}) {
	const { isPending, error, data, refetch } = useQuery({
		queryKey: hostQueryKeys.bookings.list(params),
		queryFn: () => getHostBookings(params),
		placeholderData: keepPreviousData,
	});

	return {
		loading: isPending,
		error,
		bookings: data?.data ?? [],
		meta: data?.meta,
		refetch,
	};
}
