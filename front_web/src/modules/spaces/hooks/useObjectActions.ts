import { useQueryClient } from "@tanstack/react-query";
import { objectQueryKeys } from "@/modules/objects/queryKeys";
import {
	archiveObject as archiveObjectRequest,
	createObject as createObjectRequest,
	updateObject as updateObjectRequest,
} from "@/modules/objects/services/objectService";
import type {
	CreateObjectInput,
	UpdateObjectInput,
} from "@/modules/objects/types";

/**
 * Every write the space browser makes. Each one invalidates the space's object
 * queries, so a table, a view and the palette all agree afterwards without any
 * of them being told individually.
 */
export function useObjectActions(spaceId?: string) {
	const client = useQueryClient();

	async function refreshObjects() {
		if (!spaceId) {
			return;
		}

		await client.invalidateQueries({ queryKey: objectQueryKeys.all });
	}

	async function createObject(input: CreateObjectInput) {
		const created = await createObjectRequest(spaceId as string, input);

		await refreshObjects();

		return created;
	}

	async function updateObject(objectId: string, input: UpdateObjectInput) {
		const updated = await updateObjectRequest(objectId, input);

		await refreshObjects();

		return updated;
	}

	async function setDetail(objectId: string, key: string, value: unknown) {
		return updateObject(objectId, { details: { [key]: value } });
	}

	async function archiveObject(objectId: string) {
		await archiveObjectRequest(objectId);

		await refreshObjects();
	}

	return { createObject, updateObject, setDetail, archiveObject };
}
