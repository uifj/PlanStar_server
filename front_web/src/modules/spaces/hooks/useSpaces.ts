import { useQuery, useQueryClient } from "@tanstack/react-query";
import { spaceQueryKeys } from "../queryKeys";
import { getSpaces, createSpace as postSpace } from "../services/spaceService";

export function useSpaces() {
	const client = useQueryClient();

	const { isPending, isFetching, error, data, refetch } = useQuery({
		queryKey: spaceQueryKeys.list,
		queryFn: getSpaces,
	});

	async function createSpace(name: string) {
		const created = await postSpace(name);

		await client.invalidateQueries({ queryKey: spaceQueryKeys.all });

		return created;
	}

	return {
		loading: isPending && isFetching,
		error,
		spaces: data?.data ?? [],
		createSpace,
		refetch,
	};
}
