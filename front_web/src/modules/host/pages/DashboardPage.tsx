import { Link } from "react-router";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import VanCard from "@/shared/domain/vans/components/VanCard";
import { useVans } from "@/shared/domain/vans/hooks/useVans";
import { useTranslation } from "@/shared/i18n";
import { DashboardStatCard } from "../components/DashboardStatCard";
import { useDashboard } from "../hooks/useDashboard";
import { hostRoutePaths } from "../routes";

export default function DashboardPage() {
	const { t } = useTranslation();
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
				eyebrow={t("host.dashboard.eyebrow")}
				title={t("host.dashboard.title")}
				aside={
					<p className="font-medium text-muted-foreground">
						{t("host.lastDays", { days: dashboard.days })}
					</p>
				}
			/>

			<div className="grid gap-6 md:grid-cols-3">
				<DashboardStatCard
					label={t("host.dashboard.recentIncome")}
					value={`$${dashboard.income.toLocaleString()}`}
					description={t("host.dashboard.acrossBookings", {
						count: dashboard.bookingCount,
					})}
				/>
				<DashboardStatCard
					label={t("host.dashboard.reviewScore")}
					value={dashboard.averageReviewScore.toFixed(1)}
					description={t("host.dashboard.fromReviews", {
						count: dashboard.reviewCount,
					})}
					variant="panel"
				/>
				<DashboardStatCard
					label={t("host.dashboard.listedVans")}
					value={dashboard.listedVanCount}
					description={t("host.dashboard.available")}
					variant="dark"
				/>
			</div>

			<section aria-labelledby="dashboard-vans" className="mt-10">
				<div className="mb-4 flex items-end justify-between gap-4">
					<div>
						<p className="font-semibold text-primary text-sm uppercase tracking-widest">
							{t("host.dashboard.yourVans")}
						</p>
						<h2
							id="dashboard-vans"
							className="mt-2 font-black text-2xl text-foreground"
						>
							{t("host.dashboard.recentlyListed")}
						</h2>
					</div>

					<Link
						to={hostRoutePaths.vans}
						className="font-semibold text-muted-foreground transition-colors hover:text-primary"
					>
						{t("host.dashboard.viewAll")}
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
