import { apiClient } from "@/shared/api/apiClient";
import { apiPaths } from "@/shared/api/endpoints";
import type {
	SpaceRelation,
	SpaceRelationsResponse,
	SpaceSummary,
	SpacesResponse,
	SpaceType,
	SpaceTypesResponse,
} from "../types";

const REGISTRY_LIMIT = 100;

export async function getSpaces(): Promise<SpacesResponse> {
	const response = await apiClient.get<SpacesResponse>(apiPaths.spaces.list);

	return response.data;
}

export async function createSpace(name: string): Promise<SpaceSummary> {
	const response = await apiClient.post<SpaceSummary>(apiPaths.spaces.list, {
		name,
	});

	return response.data;
}

export async function getSpaceTypes(spaceId: string): Promise<SpaceType[]> {
	const response = await apiClient.get<SpaceTypesResponse>(
		apiPaths.spaces.objectTypes(spaceId),
		{ params: { limit: REGISTRY_LIMIT } },
	);

	return response.data.data;
}

export async function getSpaceRelations(
	spaceId: string,
): Promise<SpaceRelation[]> {
	const response = await apiClient.get<SpaceRelationsResponse>(
		apiPaths.spaces.relations(spaceId),
		{ params: { limit: REGISTRY_LIMIT } },
	);

	return response.data.data;
}
