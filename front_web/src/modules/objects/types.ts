export const objectLayouts = ["basic", "relation", "objectType"] as const;

export const filterOperators = [
	"equal",
	"notEqual",
	"greater",
	"greaterOrEqual",
	"less",
	"lessOrEqual",
	"like",
	"notLike",
	"in",
	"allIn",
	"empty",
	"notEmpty",
] as const;

export type ObjectLayout = (typeof objectLayouts)[number];
export type FilterOperator = (typeof filterOperators)[number];
export type SortOrder = "asc" | "desc";

export interface ObjectFilter {
	key: string;
	operator: FilterOperator;
	value?: unknown;
}

export interface ObjectDetail {
	id: string;
	spaceId: string;
	typeId: string | null;
	layout: ObjectLayout | null;
	resolvedLayout: ObjectLayout;
	name: string;
	description: string | null;
	snippet: string | null;
	iconEmoji: string | null;
	details: Record<string, unknown>;
	isArchived: boolean;
	isDeleted: boolean;
	isHidden: boolean;
	isFavorite: boolean;
	done: boolean | null;
	creatorId: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface ListMeta {
	page: number;
	limit: number;
	total: number;
	totalPages: number;
}

export interface ObjectsResponse {
	data: ObjectDetail[];
	meta: ListMeta;
}

export interface ObjectsQueryParams {
	page?: number;
	limit?: number;
	sort?: string;
	order?: SortOrder;
	layout?: ObjectLayout;
	typeId?: string;
	filters?: ObjectFilter[];
}

export interface CreateObjectInput {
	typeId?: string;
	name: string;
	description?: string;
	details?: Record<string, unknown>;
}

export interface UpdateObjectInput {
	name?: string;
	description?: string | null;
	details?: Record<string, unknown | null>;
}
