export interface VansResponse {
	data: Van[];
	meta: Meta;
}

export const vanTypes = ["simple", "luxury", "rugged"] as const;
const vanSortOptions = ["name", "price", "rating", "createdAt"] as const;
const sortOrders = ["asc", "desc"] as const;

export type VanType = (typeof vanTypes)[number];
type VanSort = (typeof vanSortOptions)[number];
type SortOrder = (typeof sortOrders)[number];

export interface VansQueryParams {
	type?: VanType;
	search?: string;
	page?: number;
	limit?: number;
	sort?: VanSort;
	order?: SortOrder;
}

export interface Van {
	id: string;
	name: string;
	price: number;
	imageUrl: string;
	type: VanType;
	location: string;
	rating: number;
}

export interface VanDetail extends Van {
	description: string;
	sleeps: number;
	amenities: string[];
}

interface Meta {
	page: number;
	limit: number;
	total: number;
	totalPages: number;
}
