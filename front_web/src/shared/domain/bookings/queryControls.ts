export const bookingStatusFilters = [
	"pending",
	"confirmed",
	"completed",
	"cancelled",
] as const;

export const bookingSortChoices = [
	"newest",
	"oldest",
	"soonest-trip",
	"latest-trip",
	"highest-total",
	"lowest-total",
] as const;
