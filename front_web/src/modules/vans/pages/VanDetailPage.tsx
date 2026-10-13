import { FaStar } from "react-icons/fa6";
import { useLocation, useParams } from "react-router";
import { BackButton } from "@/shared/components/BackButton";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import VanTypeBadge from "@/shared/domain/vans/components/VanTypeBadge";
import { useVan } from "@/shared/domain/vans/hooks/useVan";
import { useTranslation } from "@/shared/i18n";
import { BookingPanel } from "../components/BookingPanel";

export default function VanDetailPage() {
	const { id } = useParams();
	const location = useLocation();
	const { t } = useTranslation();
	const { van, loading, error, refetch } = useVan(id);

	const search = location.state?.search || "";
	const type = location.state?.type || "all";
	const backText =
		type === "all"
			? t("vans.backToAll")
			: t("vans.backToType", { type: t(`vans.type.${type}`) });

	if (loading) {
		return <LoadingSpinner />;
	}

	if (error) {
		return <ErrorMessage onRetry={refetch} />;
	}

	if (van) {
		return (
			<section className="mx-auto max-w-7xl px-6 py-16 md:py-20">
				<BackButton
					to={`..${search}`}
					className="mb-10 text-muted-foreground hover:text-primary"
					text={backText}
				/>

				<div className="grid gap-10 lg:grid-cols-2 lg:items-start lg:gap-16">
					<div className="overflow-hidden rounded-2xl bg-secondary shadow-md">
						<img
							src={van.imageUrl}
							alt={van.name}
							className="aspect-square w-full object-cover"
						/>
					</div>

					<div className="grid gap-8 py-2">
						<div>
							<VanTypeBadge type={van.type} className="mb-6 w-fit" />

							<h1 className="mb-4 text-balance font-black text-4xl text-foreground leading-tight md:text-6xl">
								{van.name}
							</h1>

							<div className="mb-6 flex flex-wrap gap-3 font-semibold text-muted-foreground text-sm">
								<span>{van.location}</span>
								<span className="inline-flex items-center gap-1 text-foreground">
									<FaStar className="text-primary" aria-hidden="true" />
									{van.rating.toFixed(1)}
								</span>
								<span>{t("vans.sleepsCount", { count: van.sleeps })}</span>
							</div>

							<p className="mb-8 text-muted-foreground">
								<span className="font-black text-3xl text-foreground">
									${van.price}
								</span>
								<span className="font-semibold text-lg">
									{" "}
									{t("vans.perDay")}
								</span>
							</p>

							<p className="max-w-2xl font-medium text-lg text-muted-foreground leading-9">
								{van.description}
							</p>

							<div className="mt-8 flex flex-wrap gap-3">
								{van.amenities.map((amenity) => (
									<span
										key={amenity}
										className="rounded-lg bg-secondary px-4 py-2 font-semibold text-muted-foreground text-sm"
									>
										{amenity}
									</span>
								))}
							</div>
						</div>

						<BookingPanel van={van} />
					</div>
				</div>
			</section>
		);
	}

	return (
		<section className="mx-auto max-w-7xl px-6 py-16 md:py-20">
			<BackButton
				to={`..${search}`}
				className="mb-10 text-muted-foreground hover:text-primary"
				text={backText}
			/>
			<EmptyState
				title={t("vans.vanNotFound")}
				message={t("vans.vanNotFoundMessage")}
			/>
		</section>
	);
}
