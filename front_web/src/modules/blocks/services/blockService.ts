import { apiClient } from "@/shared/api/apiClient";
import { apiPaths } from "@/shared/api/endpoints";
import type {
	BlockListResponse,
	DocumentBlock,
	UpdateBlockInput,
} from "../types";

export async function getBlocks(objectId: string) {
	const response = await apiClient.get<BlockListResponse>(
		apiPaths.objects.blocks(objectId),
	);

	return response.data.data;
}

export async function updateBlock(blockId: string, input: UpdateBlockInput) {
	const response = await apiClient.patch<DocumentBlock>(
		apiPaths.blocks.item(blockId),
		input,
	);

	return response.data;
}
