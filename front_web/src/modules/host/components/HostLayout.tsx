import { Outlet } from "react-router";
import { Nav } from "@/shared/components/Nav";
import { hostNavigation } from "../navigation";

export default function HostLayout() {
	return (
		<section className="mx-auto max-w-7xl px-6 py-12 md:py-16">
			<Nav
				links={hostNavigation}
				variant="secondary"
				className="mb-12 flex-wrap gap-x-4 gap-y-2"
				ariaLabel="Host navigation"
			/>
			<Outlet />
		</section>
	);
}
