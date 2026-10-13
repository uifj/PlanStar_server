import type { RelationDefinition } from "./filters.js";

export const OBJECT_LAYOUTS = ["basic", "relation", "objectType"] as const;

export const LISTABLE_OBJECT_LAYOUTS = ["basic"] as const;

export const DEFAULT_OBJECT_SORT_FIELD = "updatedAt";
export const DEFAULT_OBJECT_SORT_ORDER = "desc";

export const MAX_FILTER_JSON_LENGTH = 4000;

// Relations the object table already stores as columns (ADR-0002). The keys are
// client-facing; the SQL fragments come from this table, never from the client.
export const SYSTEM_RELATIONS: Record<string, RelationDefinition> = {
	name: { format: "shortText", column: 'o."name"' },
	description: { format: "longText", column: 'o."description"' },
	snippet: { format: "longText", column: 'o."snippet"' },
	iconEmoji: { format: "shortText", column: 'o."iconEmoji"' },
	creatorId: { format: "shortText", column: 'o."creatorId"' },
	typeId: { format: "shortText", column: 'o."typeId"' },
	resolvedLayout: { format: "select", column: 'o."resolvedLayout"' },
	done: { format: "checkbox", column: 'o."done"' },
	isFavorite: { format: "checkbox", column: 'o."isFavorite"' },
	isArchived: { format: "checkbox", column: 'o."isArchived"' },
	isHidden: { format: "checkbox", column: 'o."isHidden"' },
	createdAt: { format: "date", column: 'o."createdAt"' },
	updatedAt: { format: "date", column: 'o."updatedAt"' },
};
