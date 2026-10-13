import { Link } from "react-router";
import HomeHero from "@/assets/images/home-hero-unsplash-mountain-van.jpg";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { vansRoutePaths } from "@/modules/vans/routes";
import { useTranslation } from "@/shared/i18n";

export default function HomePage() {
	const { t } = useTranslation();

	return (
		<section className="relative isolate min-h-dvh overflow-hidden">
			<img
				src={HomeHero}
				alt={t("home.imageAlt")}
				className="absolute inset-0 -z-20 h-full w-full object-cover"
			/>
			<div className="absolute inset-0 -z-10 bg-foreground/55" />

			<div className="mx-auto flex min-h-dvh max-w-7xl items-center px-6 py-20">
				<div className="max-w-3xl">
					<p className="mb-4 font-semibold text-secondary text-sm uppercase tracking-widest">
						{t("home.eyebrow")}
					</p>

					<h1 className="max-w-2xl text-balance font-black text-5xl text-card leading-none md:text-7xl">
						{t("home.title")}
					</h1>

					<p className="mt-6 max-w-xl font-medium text-lg text-secondary leading-8">
						{t("home.subtitle")}
					</p>

					<Link
						to={vansRoutePaths.root}
						className={cn(
							buttonVariants({ size: "lg" }),
							"mt-10 rounded-lg px-6 py-3 font-bold",
						)}
					>
						{t("home.cta")}
					</Link>
				</div>
			</div>
		</section>
	);
}
