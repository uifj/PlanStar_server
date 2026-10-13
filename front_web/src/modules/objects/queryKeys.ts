import type { ObjectsQueryParams } from "./types";

export const objectQueryKeys = {
	all: ["objects"] as const,
	list: (spaceId: string, params: ObjectsQueryParams = {}) =>
		[...objectQueryKeys.all, spaceId, params] as const,
	detail: (objectId: string) => [...objectQueryKeys.all, objectId] as const,
};
