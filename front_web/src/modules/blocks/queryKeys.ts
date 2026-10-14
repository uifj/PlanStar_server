export const blockQueryKeys = {
	all: ["blocks"] as const,
	document: (objectId: string) => [...blockQueryKeys.all, objectId] as const,
};
