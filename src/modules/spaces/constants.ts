export const SPACE_STATUSES = ["active", "archived"] as const;

export const SPACE_PERMISSIONS = [
	"reader",
	"writer",
	"admin",
	"owner",
] as const;

export const GRANTABLE_SPACE_PERMISSIONS = [
	"reader",
	"writer",
	"admin",
] as const;

export const SPACE_SORT_FIELDS = ["name", "createdAt", "updatedAt"] as const;

export const DEFAULT_SPACE_SORT_FIELD = "createdAt";
export const DEFAULT_SPACE_SORT_ORDER = "desc";
