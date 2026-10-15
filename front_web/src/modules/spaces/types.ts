import type { ObjectDetail } from "@/modules/objects/types";

export const spacePermissions = ["reader", "writer", "admin", "owner"] as const;

export const relationFormats = [
	"shortText",
	"longText",
	"number",
	"date",
	"checkbox",
	"select",
	"multiSelect",
	"object",
] as const;

export type SpacePermission = (typeof spacePermissions)[number];
export type RelationFormat = (typeof relationFormats)[number];

export interface ListMeta {
	page: number;
	limit: number;
	total: number;
	totalPages: number;
}

export interface SpaceSummary {
	id: string;
	name: string;
	status: "active" | "archived";
	permission: SpacePermission;
	createdAt: string;
	updatedAt: string;
}

export interface SpacesResponse {
	data: SpaceSummary[];
	meta: ListMeta;
}

export interface SpaceType {
	id: string;
	spaceId: string;
	uniqueKey: string;
	name: string;
	description: string | null;
	iconEmoji: string | null;
	layout: string;
	relationKeys: string[];
}

export interface SpaceTypesResponse {
	data: SpaceType[];
	meta: ListMeta;
}

export interface SpaceRelation {
	id: string;
	spaceId: string;
	typeId: string | null;
	uniqueKey: string;
	format: RelationFormat;
	name: string;
	description: string | null;
	isReadOnly: boolean;
	isHidden: boolean;
	maxCount: number | null;
}

export interface SpaceRelationsResponse {
	data: SpaceRelation[];
	meta: ListMeta;
}

export interface ViewSort {
	key: string;
	order: "asc" | "desc";
}

export interface SaveViewInput {
	name: string;
	sourceTypeId: string;
	viewType?: string;
	groupRelationKey?: string;
	coverRelationKey?: string;
	filters: Record<string, unknown>[];
	sorts: ViewSort[];
}

// What the layout menu writes onto a view. null clears a key, so a board can stop
// grouping by a relation. The server checks these against the view's own type.
export interface ViewLayoutInput {
	viewType?: string;
	coverRelationKey?: string | null;
	groupRelationKey?: string | null;
}

export interface ViewRecordsResponse {
	data: ObjectDetail[];
	meta: ListMeta;
	counters: { matched: number; total: number };
}
