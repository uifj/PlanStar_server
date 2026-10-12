import type { VansQueryParams } from "./types";

export const vanQueryKeys = {
	all: ["vans"] as const,
	list: (params: VansQueryParams = {}) =>
		[...vanQueryKeys.all, params] as const,
	detail: (id: string) => [...vanQueryKeys.all, id] as const,
	hostList: ["host", "vans"] as const,
	hostDetail: (id: string) => ["host", "vans", id] as const,
};
