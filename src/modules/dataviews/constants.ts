import type { ObjectSortInput } from "../objects/filters.js";

export const DATAVIEW_LAYOUT = "dataview";

export const DATAVIEW_VIEW_TYPES = ["grid"] as const;

// The view's source is an object-valued relation, so it lives in Link (ADR-0002).
export const DATAVIEW_SOURCE_RELATION = "setSource";

export const DEFAULT_DATAVIEW_SORTS: ObjectSortInput[] = [
	{ key: "updatedAt", order: "desc" },
];
