import { useQuery } from "@tanstack/react-query";
import { vanQueryKeys } from "../queryKeys";
import { getVan } from "../services/vanService";

interface UseVanOptions {
	isHost?: boolean;
}

export function useVan(
	id: string | undefined,
	{ isHost = false }: UseVanOptions = {},
) {
	const queryKey = isHost
		? vanQueryKeys.hostDetail(id ?? "")
		: vanQueryKeys.detail(id ?? "");

	const { isPending, error, data, refetch } = useQuery({
		queryKey,
		queryFn: () => {
			if (!id) {
				throw new Error("Van ID is required");
			}

			return getVan(id, { isHost });
		},
		enabled: Boolean(id),
	});

	return { loading: isPending, error, van: data ?? null, refetch };
}
