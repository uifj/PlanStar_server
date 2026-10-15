import type { ObjectDetail } from "@/modules/objects/types";
import { apiClient } from "@/shared/api/apiClient";
import { apiPaths } from "@/shared/api/endpoints";
import type {
	ListMeta,
	SaveViewInput,
	ViewLayoutInput,
	ViewRecordsResponse,
} from "../types";

const VIEWS_PAGE_SIZE = 100;

/**
 * Saved views are objects with the dataview layout (ADR-0012), so they are read
 * and renamed through the generic object routes rather than a views-only API.
 */
export async function getDataviews(spaceId: string): Promise<ObjectDetail[]> {
	const response = await apiClient.get<{
		data: ObjectDetail[];
		meta: ListMeta;
	}>(apiPaths.spaces.objects(spaceId), {
		params: { layout: "dataview", limit: VIEWS_PAGE_SIZE },
	});

	// The kernel lists archived objects too; a rail of retired views is not useful.
	return response.data.data.filter((view) => !view.isArchived);
}

export async function createDataview(
	spaceId: string,
	input: SaveViewInput,
): Promise<ObjectDetail> {
	const response = await apiClient.post<ObjectDetail>(
		apiPaths.spaces.dataviews(spaceId),
		input,
	);

	return response.data;
}

export async function renameDataview(
	objectId: string,
	name: string,
): Promise<ObjectDetail> {
	const response = await apiClient.patch<ObjectDetail>(
		apiPaths.objects.detail(objectId),
		{ name },
	);

	return response.data;
}

export async function archiveDataview(objectId: string): Promise<void> {
	await apiClient.delete(apiPaths.objects.detail(objectId));
}

// A layout and its relations are the view's own configuration, so they go through
// the dataview route: the object write would refuse them as unknown relations.
export async function updateDataviewLayout(
	spaceId: string,
	dataviewId: string,
	input: ViewLayoutInput,
): Promise<ObjectDetail> {
	const response = await apiClient.patch<ObjectDetail>(
		apiPaths.spaces.dataviewItem(spaceId, dataviewId),
		input,
	);

	return response.data;
}

export async function getDataviewRecords(
	spaceId: string,
	dataviewId: string,
	params: { page?: number; limit?: number } = {},
): Promise<ViewRecordsResponse> {
	const response = await apiClient.get<ViewRecordsResponse>(
		apiPaths.spaces.dataviewRecords(spaceId, dataviewId),
		{ params },
	);

	return response.data;
}
