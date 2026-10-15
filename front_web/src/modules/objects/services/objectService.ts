import { apiClient } from "@/shared/api/apiClient";
import { apiPaths } from "@/shared/api/endpoints";
import type {
	CreateObjectInput,
	ObjectDetail,
	ObjectsQueryParams,
	ObjectsResponse,
	UpdateObjectInput,
} from "../types";

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

export async function createObject(
	spaceId: string,
	input: CreateObjectInput,
): Promise<ObjectDetail> {
	const response = await apiClient.post<ObjectDetail>(
		apiPaths.spaces.objects(spaceId),
		input,
	);

	return response.data;
}

// The kernel merges `details` and replaces `null` values, so a caller sends only
// the keys it touched.
export async function updateObject(
	objectId: string,
	input: UpdateObjectInput,
): Promise<ObjectDetail> {
	const response = await apiClient.patch<ObjectDetail>(
		apiPaths.objects.detail(objectId),
		input,
	);

	return response.data;
}

export async function archiveObject(objectId: string): Promise<void> {
	await apiClient.delete(apiPaths.objects.detail(objectId));
}

export async function getObject(objectId: string): Promise<ObjectDetail> {
	const response = await apiClient.get<ObjectDetail>(
		apiPaths.objects.detail(objectId),
	);

	return response.data;
}

export async function getObjectBacklinks(
	objectId: string,
): Promise<ObjectDetail[]> {
	const response = await apiClient.get<ObjectsResponse>(
		apiPaths.objects.backlinks(objectId),
		{ params: { limit: 20 } },
	);

	return response.data.data;
}
