import { Link, useParams } from "react-router";
import { BackButton } from "@/shared/components/BackButton";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import VanTypeBadge from "@/shared/domain/vans/components/VanTypeBadge";
import { useVan } from "@/shared/domain/vans/hooks/useVan";
import { HostVanArchiveAction } from "../components/HostVanArchiveAction";
import VanInfo from "../components/VanInfo";

export default function HostVanDetailPage() {
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
				<BackButton to=".." className="mb-8 text-muted hover:text-clay" />
				<section className="rounded-2xl bg-surface p-6 shadow-sm md:p-8">
					<div className="mb-8 flex flex-col gap-6 md:flex-row md:items-center">
						<img
							src={van.imageUrl}
							alt={van.name}
							className="aspect-video w-full rounded-xl object-cover md:size-40"
						/>
						<div>
							<VanTypeBadge type={van.type} className="mb-4 inline-block" />
							<h1 className="font-black text-4xl text-ink leading-tight">
								{van.name}
							</h1>
							<p className="mt-2 text-muted">
								<span className="font-black text-2xl text-ink">
									${van.price}
								</span>
								<span className="font-semibold text-base"> / day</span>
							</p>
						</div>
						<Link
							to="edit"
							className="inline-flex w-full justify-center rounded-lg bg-clay px-5 py-3 font-bold text-surface transition-colors hover:bg-clay-dark active:scale-95 md:ml-auto md:w-fit"
						>
							Edit van
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
			title="Van not found"
			message="This van may not exist, or it may not belong to your host account."
		/>
	);
}
