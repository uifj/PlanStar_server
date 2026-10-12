import { Link } from "react-router";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import VanCard from "@/shared/domain/vans/components/VanCard";
import { useVans } from "@/shared/domain/vans/hooks/useVans";
import { hostRoutePaths } from "../routes";

export default function HostVansPage() {
	const { vans, loading, error, refetch } = useVans({ isHost: true });

	const vanElements = vans.map((van) => (
		<VanCard key={van.id} van={van} to={van.id} />
	));

	if (loading) {
		return <LoadingSpinner />;
	}

	if (error) {
		return <ErrorMessage onRetry={refetch} />;
	}

	return (
		<>
			<PageHeader
				eyebrow="Your fleet"
				title="Your listed vans."
				className="mb-8"
				aside={
					<Link
						to={hostRoutePaths.vansCreate}
						className="inline-flex w-full justify-center rounded-lg bg-clay px-5 py-3 font-bold text-surface transition-colors hover:bg-clay-dark active:scale-95 sm:w-fit"
					>
						Add van
					</Link>
				}
			/>

			{vans.length > 0 ? (
				<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
					{vanElements}
				</div>
			) : (
				<EmptyState
					title="No listed vans"
					message="You do not have any vans listed yet. Add a van to start hosting."
				/>
			)}
		</>
	);
}
