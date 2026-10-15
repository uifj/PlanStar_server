import type { ObjectSortInput } from "../objects/filters.js";

export const DATAVIEW_LAYOUT = "dataview";

// What the space browser can draw. `graph` is deliberately absent: the kernel has no
// graph read yet, so accepting it would store a view that answers nothing.
export const DATAVIEW_VIEW_TYPES = [
	"grid",
	"gallery",
	"board",
	"calendar",
] as const;

// The view's source is an object-valued relation, so it lives in Link (ADR-0002).
export const DATAVIEW_SOURCE_RELATION = "setSource";

export const DEFAULT_DATAVIEW_SORTS: ObjectSortInput[] = [
	{ key: "updatedAt", order: "desc" },
];
