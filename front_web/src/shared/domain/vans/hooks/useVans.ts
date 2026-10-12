import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { vanQueryKeys } from "../queryKeys";
import { getVans } from "../services/vanService";
import type { VansQueryParams } from "../types";

interface UseVansOptions {
	isHost?: boolean;
	params?: VansQueryParams;
}

export function useVans({ isHost = false, params = {} }: UseVansOptions = {}) {
	const queryKey = isHost ? vanQueryKeys.hostList : vanQueryKeys.list(params);

	const { isPending, error, data, refetch } = useQuery({
		queryKey,
		queryFn: () => getVans({ isHost, params }),
		placeholderData: keepPreviousData,
	});

	return {
		loading: isPending,
		error,
		vans: data?.data ?? [],
		meta: data?.meta,
		refetch,
	};
}
