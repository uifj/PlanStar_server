export interface PaginationOptions {
	page: number;
	limit: number;
}

export interface PaginationMeta {
	page: number;
	limit: number;
	total: number;
	totalPages: number;
}
