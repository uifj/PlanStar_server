import { authRoutePaths } from "@/modules/auth/routes";
import type { AuthRole } from "@/modules/auth/types";
import { bookingsRoutePaths } from "@/modules/bookings/routes";
import { hostRoutePaths } from "@/modules/host/routes";
import { vansRoutePaths } from "@/modules/vans/routes";
import type { NavItem } from "@/shared/utils/types";
import { paths } from "./paths";

const publicHeaderNavigation: NavItem[] = [
	{ to: paths.about, label: "About" },
	{ to: vansRoutePaths.root, label: "Vans" },
];

const accountHeaderNavigation: NavItem[] = [
	{ to: authRoutePaths.account, label: "Account" },
];

const authenticatedHeaderNavigation: Record<AuthRole, NavItem[]> = {
	host: [
		{ to: paths.about, label: "About" },
		{ to: hostRoutePaths.root, label: "Host" },
	],
	user: [
		...publicHeaderNavigation,
		{ to: bookingsRoutePaths.root, label: "Bookings" },
	],
};

export function getHeaderNavigation(role?: AuthRole): NavItem[] {
	if (!role) {
		return publicHeaderNavigation;
	}

	return [...authenticatedHeaderNavigation[role], ...accountHeaderNavigation];
}
