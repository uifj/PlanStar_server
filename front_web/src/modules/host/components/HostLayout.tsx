import { Outlet } from "react-router";
import { Nav } from "@/shared/components/Nav";
import { useTranslation } from "@/shared/i18n";
import { hostNavigation } from "../navigation";

export default function HostLayout() {
	const { t } = useTranslation();
	const navLinks = hostNavigation.map((link) => ({
		...link,
		label: t(link.label),
	}));

	return (
		<section className="mx-auto max-w-7xl px-6 py-12 md:py-16">
			<Nav
				links={navLinks}
				variant="secondary"
				className="mb-12 flex-wrap gap-x-4 gap-y-2"
				ariaLabel={t("host.nav.ariaLabel")}
			/>
			<Outlet />
		</section>
	);
}
