import { Link } from "react-router";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import VanCard from "@/shared/domain/vans/components/VanCard";
import { useVans } from "@/shared/domain/vans/hooks/useVans";
import { DashboardStatCard } from "../components/DashboardStatCard";
import { useDashboard } from "../hooks/useDashboard";
import { hostRoutePaths } from "../routes";

export default function DashboardPage() {
	const { dashboard, loading, error, refetch } = useDashboard();
	const {
		vans,
		loading: vansLoading,
		error: vansError,
		refetch: refetchVans,
	} = useVans({ isHost: true });

	if (loading || vansLoading) {
		return <LoadingSpinner />;
	}

	if (error) {
		return <ErrorMessage onRetry={refetch} />;
	}

	if (vansError) {
		return <ErrorMessage onRetry={refetchVans} />;
	}

	if (!dashboard) {
		return null;
	}

	const previewVans = vans.slice(0, 3);

	return (
		<section>
			<PageHeader
				eyebrow="Host dashboard"
				title="Welcome back. Your vans are ready for the next trip."
				aside={
					<p className="font-medium text-muted">Last {dashboard.days} days</p>
				}
			/>

			<div className="grid gap-6 md:grid-cols-3">
				<DashboardStatCard
					label="Recent income"
					value={`$${dashboard.income.toLocaleString()}`}
					description={`Across ${dashboard.bookingCount} bookings`}
				/>
				<DashboardStatCard
					label="Review score"
					value={dashboard.averageReviewScore.toFixed(1)}
					description={`From ${dashboard.reviewCount} reviews`}
					variant="panel"
				/>
				<DashboardStatCard
					label="Listed vans"
					value={dashboard.listedVanCount}
					description="Available for booking"
					variant="dark"
				/>
			</div>

			<section aria-labelledby="dashboard-vans" className="mt-10">
				<div className="mb-4 flex items-end justify-between gap-4">
					<div>
						<p className="font-semibold text-clay text-sm uppercase tracking-widest">
							Your vans
						</p>
						<h2
							id="dashboard-vans"
							className="mt-2 font-black text-2xl text-ink"
						>
							Recently listed
						</h2>
					</div>

					<Link
						to={hostRoutePaths.vans}
						className="font-semibold text-muted transition-colors hover:text-clay"
					>
						View all
					</Link>
				</div>

				<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
					{previewVans.map((van) => (
						<VanCard
							key={van.id}
							van={van}
							to={`${hostRoutePaths.vans}/${van.id}`}
						/>
					))}
				</div>
			</section>
		</section>
	);
}
