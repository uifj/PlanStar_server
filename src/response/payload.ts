import type { PaginationMeta } from "../pagination/types.js";

interface PaginatedResponse<T> {
	data: T[];
	meta: PaginationMeta;
}

export function paginated<T>(
	value: T[],
	meta: PaginationMeta,
): PaginatedResponse<T> {
	return {
		data: value,
		meta,
	};
}
