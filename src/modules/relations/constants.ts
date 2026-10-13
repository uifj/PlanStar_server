export const RELATION_FORMATS = [
	"shortText",
	"longText",
	"number",
	"date",
	"checkbox",
	"select",
	"multiSelect",
	"object",
] as const;

export const RELATION_SORT_FIELDS = ["name", "createdAt"] as const;

export const DEFAULT_RELATION_SORT_FIELD = "createdAt";
export const DEFAULT_RELATION_SORT_ORDER = "asc";

export const RELATION_UNIQUE_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
