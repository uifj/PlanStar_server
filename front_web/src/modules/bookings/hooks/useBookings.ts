import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { bookingQueryKeys } from "../queryKeys";
import { getBookings } from "../services/bookingService";
import type { RenterBookingsQueryParams } from "../types";

interface UseBookingsOptions {
	params?: RenterBookingsQueryParams;
}

export function useBookings({ params = {} }: UseBookingsOptions = {}) {
	const { isPending, error, data, refetch } = useQuery({
		queryKey: bookingQueryKeys.list(params),
		queryFn: () => getBookings(params),
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
