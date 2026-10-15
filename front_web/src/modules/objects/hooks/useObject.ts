import { useQuery } from "@tanstack/react-query";
import { objectQueryKeys } from "../queryKeys";
import { getObject, getObjectBacklinks } from "../services/objectService";

/**
 * One object together with the objects that link to it. The context column reads
 * both in one pass because an object's value is only half of the graph picture
 * (ADR-0002).
 */
export function useObject(objectId?: string) {
	const { isPending, isFetching, error, data, refetch } = useQuery({
		queryKey: objectQueryKeys.detail(objectId ?? ""),
		queryFn: async () => {
			const [detail, backlinks] = await Promise.all([
				getObject(objectId as string),
				getObjectBacklinks(objectId as string),
			]);

			return { detail, backlinks };
		},
		enabled: Boolean(objectId),
	});

	return {
		loading: isPending && isFetching,
		error,
		object: data?.detail,
		backlinks: data?.backlinks ?? [],
		refetch,
	};
}
