import { agentRoutePaths } from "@/modules/agent/routes";
import { authRoutePaths } from "@/modules/auth/routes";
import type { AuthRole } from "@/modules/auth/types";
import { bookingsRoutePaths } from "@/modules/bookings/routes";
import { hostRoutePaths } from "@/modules/host/routes";
import { vansRoutePaths } from "@/modules/vans/routes";
import type { NavItem } from "@/shared/utils/types";
import { paths } from "./paths";

type TranslateFn = (key: string) => string;

export function getHeaderNavigation(
	role: AuthRole | undefined,
	t: TranslateFn,
): NavItem[] {
	const about = { to: paths.about, label: t("nav.about") };
	const vans = { to: vansRoutePaths.root, label: t("nav.vans") };
	const account = { to: authRoutePaths.account, label: t("nav.account") };

	if (!role) {
		return [about, vans];
	}

	if (role === "host") {
		return [about, { to: hostRoutePaths.root, label: t("nav.host") }, account];
	}

	return [
		about,
		vans,
		{ to: agentRoutePaths.root, label: t("nav.tripPlanner") },
		{ to: bookingsRoutePaths.root, label: t("nav.bookings") },
		account,
	];
}
