import type { PaginationMeta, PaginationOptions } from "./types.js";

export function getPagination({ page, limit }: PaginationOptions) {
	return {
		skip: (page - 1) * limit,
		take: limit,
	};
}

export function createPaginationMeta({
	page,
	limit,
	total,
}: PaginationOptions & {
	total: number;
}): PaginationMeta {
	return {
		page,
		limit,
		total,
		totalPages: Math.ceil(total / limit),
	};
}
