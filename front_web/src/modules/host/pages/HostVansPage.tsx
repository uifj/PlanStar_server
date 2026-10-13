import { Link } from "react-router";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import VanCard from "@/shared/domain/vans/components/VanCard";
import { useVans } from "@/shared/domain/vans/hooks/useVans";
import { useTranslation } from "@/shared/i18n";
import { hostRoutePaths } from "../routes";

export default function HostVansPage() {
	const { t } = useTranslation();
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
				eyebrow={t("host.vans.eyebrow")}
				title={t("host.vans.title")}
				className="mb-8"
				aside={
					<Link
						to={hostRoutePaths.vansCreate}
						className={cn(buttonVariants(), "w-full sm:w-fit")}
					>
						{t("host.vans.add")}
					</Link>
				}
			/>

			{vans.length > 0 ? (
				<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
					{vanElements}
				</div>
			) : (
				<EmptyState
					title={t("host.vans.emptyTitle")}
					message={t("host.vans.emptyMessage")}
				/>
			)}
		</>
	);
}
