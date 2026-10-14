const SPACES = ["spaces"] as const;

export const spaceQueryKeys = {
	all: SPACES,
	list: [...SPACES, "list"] as const,
	registry: (spaceId: string) => [...SPACES, spaceId, "registry"] as const,
	dataviews: (spaceId: string) => [...SPACES, spaceId, "dataviews"] as const,
};
