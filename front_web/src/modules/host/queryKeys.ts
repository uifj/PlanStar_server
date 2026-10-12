import type { BookingsQueryParams } from "@/shared/domain/bookings/types";

export const hostQueryKeys = {
	dashboard: {
		all: ["host", "dashboard"] as const,
		detail: (days: number) => [...hostQueryKeys.dashboard.all, days] as const,
	},
	income: {
		all: ["host", "income"] as const,
		detail: (days: number) => [...hostQueryKeys.income.all, days] as const,
	},
	reviews: {
		all: ["host", "reviews"] as const,
		detail: (days: number) => [...hostQueryKeys.reviews.all, days] as const,
	},
	bookings: {
		all: ["host", "bookings"] as const,
		list: (params: BookingsQueryParams = {}) =>
			[...hostQueryKeys.bookings.all, params] as const,
	},
};
