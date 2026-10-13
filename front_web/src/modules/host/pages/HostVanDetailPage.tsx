import { Link, useParams } from "react-router";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BackButton } from "@/shared/components/BackButton";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import VanTypeBadge from "@/shared/domain/vans/components/VanTypeBadge";
import { useVan } from "@/shared/domain/vans/hooks/useVan";
import { useTranslation } from "@/shared/i18n";
import { HostVanArchiveAction } from "../components/HostVanArchiveAction";
import VanInfo from "../components/VanInfo";

export default function HostVanDetailPage() {
	const { t } = useTranslation();
	const { id } = useParams();
	const { van, loading, error, refetch } = useVan(id, { isHost: true });

	if (loading) {
		return <LoadingSpinner />;
	}

	if (error) {
		return <ErrorMessage onRetry={refetch} />;
	}

	if (van) {
		return (
			<>
				<BackButton
					to=".."
					className="mb-8 text-muted-foreground hover:text-primary"
				/>
				<section className="rounded-2xl bg-card p-6 shadow-sm md:p-8">
					<div className="mb-8 flex flex-col gap-6 md:flex-row md:items-center">
						<img
							src={van.imageUrl}
							alt={van.name}
							className="aspect-video w-full rounded-xl object-cover md:size-40"
						/>
						<div>
							<VanTypeBadge type={van.type} className="mb-4 inline-block" />
							<h1 className="font-black text-4xl text-foreground leading-tight">
								{van.name}
							</h1>
							<p className="mt-2 text-muted-foreground">
								<span className="font-black text-2xl text-foreground">
									${van.price}
								</span>
								<span className="font-semibold text-base">
									{t("host.van.perDay")}
								</span>
							</p>
						</div>
						<Link
							to="edit"
							className={cn(buttonVariants(), "w-full md:ml-auto md:w-fit")}
						>
							{t("host.van.edit")}
						</Link>
					</div>

					<VanInfo van={van} />
					<HostVanArchiveAction vanId={van.id} vanName={van.name} />
				</section>
			</>
		);
	}

	return (
		<EmptyState
			title={t("host.van.notFoundTitle")}
			message={t("host.van.notFoundMessage")}
		/>
	);
}
