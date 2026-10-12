export const VAN_TYPES = ["simple", "luxury", "rugged"] as const;

export const VAN_SORT_FIELDS = [
	"name",
	"price",
	"rating",
	"createdAt",
] as const;

export const DEFAULT_VAN_SORT_FIELD = "createdAt";
export const DEFAULT_VAN_SORT_ORDER = "desc";
