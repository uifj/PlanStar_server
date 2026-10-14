import { useQuery, useQueryClient } from "@tanstack/react-query";
import { spaceQueryKeys } from "../queryKeys";
import {
	archiveDataview,
	createDataview,
	getDataviews,
	renameDataview,
} from "../services/dataviewService";
import type { SaveViewInput } from "../types";

export function useDataviews(spaceId?: string) {
	const client = useQueryClient();

	const { isPending, isFetching, error, data, refetch } = useQuery({
		queryKey: spaceQueryKeys.dataviews(spaceId ?? ""),
		queryFn: () => getDataviews(spaceId as string),
		enabled: Boolean(spaceId),
	});

	async function refresh() {
		await client.invalidateQueries({
			queryKey: spaceQueryKeys.dataviews(spaceId as string),
		});
	}

	async function saveView(input: SaveViewInput) {
		const created = await createDataview(spaceId as string, input);

		await refresh();

		return created;
	}

	async function renameView(objectId: string, name: string) {
		const renamed = await renameDataview(objectId, name);

		await refresh();

		return renamed;
	}

	async function archiveView(objectId: string) {
		await archiveDataview(objectId);

		await refresh();
	}

	return {
		loading: isPending && isFetching,
		error,
		views: data ?? [],
		saveView,
		renameView,
		archiveView,
		refetch,
	};
}
