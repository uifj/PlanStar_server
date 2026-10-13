import { Link } from "react-router";
import AboutHero from "@/assets/images/about-hero-pexels-van.jpg";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { vansRoutePaths } from "@/modules/vans/routes";
import { useTranslation } from "@/shared/i18n";

export default function AboutPage() {
	const { t } = useTranslation();

	return (
		<section>
			<div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 md:py-20 lg:grid-cols-2 lg:items-center lg:py-28">
				<div>
					<p className="mb-6 font-semibold text-primary text-sm uppercase tracking-widest">
						{t("about.eyebrow1")}
					</p>

					<h1 className="max-w-2xl text-balance font-black text-4xl text-foreground leading-tight md:text-6xl md:leading-tight">
						{t("about.title")}
					</h1>

					<div className="mt-10 max-w-2xl space-y-6 font-medium text-lg text-muted-foreground leading-9">
						<p>{t("about.p1")}</p>
						<p>{t("about.p2")}</p>
					</div>
				</div>

				<img
					src={AboutHero}
					alt={t("about.imageAlt")}
					className="aspect-video w-full rounded-2xl object-cover shadow-md lg:aspect-square"
				/>
			</div>

			<div className="mx-auto max-w-7xl px-6 pb-16 md:pb-20">
				<div className="grid gap-6 rounded-xl border border-border bg-secondary p-6 shadow-sm md:grid-cols-2 md:items-center md:p-10">
					<div>
						<p className="font-semibold text-primary text-sm uppercase tracking-widest">
							{t("about.eyebrow2")}
						</p>
						<h2 className="mt-3 max-w-xl font-black text-2xl text-foreground leading-tight md:mt-4 md:text-3xl">
							{t("about.heading2")}
						</h2>
					</div>

					<Link
						to={`/${vansRoutePaths.root}`}
						className={cn(
							buttonVariants(),
							"w-fit bg-forest text-card hover:bg-sage md:justify-self-end md:px-6",
						)}
					>
						{t("about.cta")}
					</Link>
				</div>
			</div>
		</section>
	);
}
