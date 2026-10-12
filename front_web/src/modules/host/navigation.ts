import type { NavItem } from "@/shared/utils/types";

export const hostNavigation: NavItem[] = [
	{ to: ".", label: "Dashboard", end: true },
	{ to: "bookings", label: "Bookings" },
	{ to: "income", label: "Income" },
	{ to: "vans", label: "Vans" },
	{ to: "reviews", label: "Reviews" },
];
