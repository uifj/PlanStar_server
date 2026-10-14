import { useQuery } from "@tanstack/react-query";
import { spaceQueryKeys } from "../queryKeys";
import { getSpaceRelations, getSpaceTypes } from "../services/spaceService";
import type { SpaceRelation, SpaceType } from "../types";

/**
 * A space's own vocabulary: which types exist and which relations they carry.
 * The browser reads both together because a column list is meaningless without
 * the formats that say how a value may be used.
 */
export function useSpaceRegistry(spaceId?: string) {
	const { isPending, isFetching, error, data, refetch } = useQuery({
		queryKey: spaceQueryKeys.registry(spaceId ?? ""),
		queryFn: async () => {
			const [types, relations] = await Promise.all([
				getSpaceTypes(spaceId as string),
				getSpaceRelations(spaceId as string),
			]);

			return { types, relations };
		},
		enabled: Boolean(spaceId),
	});

	const types: SpaceType[] = data?.types ?? [];
	const relations: SpaceRelation[] = data?.relations ?? [];
	const relationsByKey = new Map(relations.map((r) => [r.uniqueKey, r]));

	return {
		loading: isPending && isFetching,
		error,
		types,
		relations,
		relationsByKey,
		refetch,
	};
}
