export const vansSortChoices = [
	"newest",
	"oldest",
	"highest-price",
	"lowest-price",
	"highest-rating",
	"lowest-rating",
	"name-a-z",
	"name-z-a",
] as const;

export type VansSortChoice = (typeof vansSortChoices)[number];
