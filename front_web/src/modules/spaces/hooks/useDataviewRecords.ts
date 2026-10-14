import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { spaceQueryKeys } from "../queryKeys";
import { getDataviewRecords } from "../services/dataviewService";

/**
 * Running a stored view. The counters come back with the page, so the UI can say
 * "3 of 41 match" without issuing a second request of its own.
 */
export function useDataviewRecords(
	spaceId?: string,
	dataviewId?: string,
	params: { page?: number; limit?: number } = {},
) {
	const { isPending, isFetching, error, data, refetch } = useQuery({
		queryKey: [
			...spaceQueryKeys.dataviews(spaceId ?? ""),
			dataviewId ?? "",
			"records",
			params,
		],
		queryFn: () =>
			getDataviewRecords(spaceId as string, dataviewId as string, params),
		enabled: Boolean(spaceId && dataviewId),
		placeholderData: keepPreviousData,
	});

	return {
		loading: isPending && isFetching,
		error,
		records: data?.data ?? [],
		meta: data?.meta,
		counters: data?.counters,
		refetch,
	};
}
