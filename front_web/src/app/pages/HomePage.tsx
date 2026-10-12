import { Link } from "react-router";
import HomeHero from "@/assets/images/home-hero-unsplash-mountain-van.jpg";
import { vansRoutePaths } from "@/modules/vans/routes";

export default function HomePage() {
	return (
		<section className="relative isolate min-h-dvh overflow-hidden">
			<img
				src={HomeHero}
				alt="A camper van parked near mountains at sunset"
				className="absolute inset-0 -z-20 h-full w-full object-cover"
			/>
			<div className="absolute inset-0 -z-10 bg-ink/55" />

			<div className="mx-auto flex min-h-dvh max-w-7xl items-center px-6 py-20">
				<div className="max-w-3xl">
					<p className="mb-4 font-semibold text-panel text-sm uppercase tracking-widest">
						Road trips, without the rental counter
					</p>

					<h1 className="max-w-2xl text-balance font-black text-5xl text-surface leading-none md:text-7xl">
						Find the van that fits the trip.
					</h1>

					<p className="mt-6 max-w-xl font-medium text-lg text-panel leading-8">
						Browse road-ready vans for quiet weekends, long detours, and the
						kind of plans that get better once you leave town.
					</p>

					<Link
						to={vansRoutePaths.root}
						className="mt-10 inline-flex rounded-lg bg-clay px-6 py-3 font-bold text-surface transition-colors hover:bg-clay-dark active:scale-95"
					>
						Explore vans
					</Link>
				</div>
			</div>
		</section>
	);
}
