import { apiClient } from "@/shared/api/apiClient";
import { apiPaths } from "@/shared/api/endpoints";
import type { VanDetail } from "@/shared/domain/vans/types";
import type { CreateHostVanRequest, UpdateHostVanRequest } from "../types";

export async function createHostVan(van: CreateHostVanRequest) {
	const response = await apiClient.post<VanDetail>(
		apiPaths.host.vans.list,
		van,
	);

	return response.data;
}

export async function updateHostVan({ id, ...van }: UpdateHostVanRequest) {
	const response = await apiClient.patch<VanDetail>(
		apiPaths.host.vans.detail(id),
		van,
	);

	return response.data;
}

export async function archiveHostVan(id: string) {
	await apiClient.delete(apiPaths.host.vans.detail(id));
}
