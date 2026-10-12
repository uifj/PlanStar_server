import { Link } from "react-router";
import AboutHero from "@/assets/images/about-hero-pexels-van.jpg";
import { vansRoutePaths } from "@/modules/vans/routes";

export default function AboutPage() {
	return (
		<section>
			<div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 md:py-20 lg:grid-cols-2 lg:items-center lg:py-28">
				<div>
					<p className="mb-6 font-semibold text-clay text-sm uppercase tracking-widest">
						Built for slower travel
					</p>

					<h1 className="max-w-2xl text-balance font-black text-4xl text-ink leading-tight md:text-6xl md:leading-tight">
						Don&apos;t squeeze the trip into the wrong car.
					</h1>

					<div className="mt-10 max-w-2xl space-y-6 font-medium text-lg text-muted leading-9">
						<p>
							Our mission is to make road trips feel easier from the first mile.
							Every van is prepared before each booking, so your plans can stay
							focused on where you are going.
						</p>
						<p>
							We are travelers too, which means we care about the small things:
							room to stretch, simple storage, reliable handoff, and a ride that
							feels ready for a real route.
						</p>
					</div>
				</div>

				<img
					src={AboutHero}
					alt="A camper van parked in a scenic location"
					className="aspect-video w-full rounded-2xl object-cover shadow-md lg:aspect-square"
				/>
			</div>

			<div className="mx-auto max-w-7xl px-6 pb-16 md:pb-20">
				<div className="grid gap-6 rounded-xl border border-line bg-panel p-6 shadow-sm md:grid-cols-2 md:items-center md:p-10">
					<div>
						<p className="font-semibold text-clay text-sm uppercase tracking-widest">
							Ready when you are
						</p>
						<h2 className="mt-3 max-w-xl font-black text-2xl text-ink leading-tight md:mt-4 md:text-3xl">
							Your destination is waiting. Your van should be ready too.
						</h2>
					</div>

					<Link
						to={`/${vansRoutePaths.root}`}
						className="inline-flex w-fit rounded-lg bg-forest px-5 py-3 font-bold text-surface transition-colors hover:bg-sage active:scale-95 md:justify-self-end md:px-6"
					>
						Explore vans
					</Link>
				</div>
			</div>
		</section>
	);
}
