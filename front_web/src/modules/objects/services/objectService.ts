import { apiClient } from "@/shared/api/apiClient";
import { apiPaths } from "@/shared/api/endpoints";
import type { ObjectsQueryParams, ObjectsResponse } from "../types";

export async function getObjects(
	spaceId: string,
	params: ObjectsQueryParams = {},
) {
	const { filters, ...rest } = params;
	const response = await apiClient.get<ObjectsResponse>(
		apiPaths.spaces.objects(spaceId),
		{
			params: filters?.length
				? { ...rest, filters: JSON.stringify(filters) }
				: rest,
		},
	);

	return response.data;
}
