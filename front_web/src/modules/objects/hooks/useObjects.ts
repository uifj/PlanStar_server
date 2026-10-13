import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { objectQueryKeys } from "../queryKeys";
import { getObjects } from "../services/objectService";
import type { ObjectsQueryParams } from "../types";

interface UseObjectsOptions {
	spaceId?: string;
	query?: ObjectsQueryParams;
}

export function useObjects({ spaceId, query = {} }: UseObjectsOptions) {
	const { isPending, isFetching, error, data, refetch } = useQuery({
		queryKey: objectQueryKeys.list(spaceId ?? "", query),
		queryFn: () => getObjects(spaceId as string, query),
		enabled: Boolean(spaceId),
		placeholderData: keepPreviousData,
	});

	return {
		loading: isPending && isFetching,
		error,
		objects: data?.data ?? [],
		meta: data?.meta,
		refetch,
	};
}
