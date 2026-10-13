import type { NavItem } from "@/shared/utils/types";

export const hostNavigation: NavItem[] = [
	{ to: ".", label: "host.nav.dashboard", end: true },
	{ to: "bookings", label: "host.nav.bookings" },
	{ to: "income", label: "host.nav.income" },
	{ to: "vans", label: "host.nav.vans" },
	{ to: "reviews", label: "host.nav.reviews" },
];
