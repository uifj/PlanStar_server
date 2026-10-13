import { Button } from "@/components/ui/button";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import { PaginationControls } from "@/shared/components/PaginationControls";
import VanCard from "@/shared/domain/vans/components/VanCard";
import { useVans } from "@/shared/domain/vans/hooks/useVans";
import { vanTypes } from "@/shared/domain/vans/types";
import { useTranslation } from "@/shared/i18n";
import VansBrowseControls from "../components/VansBrowseControls";
import VanTypeFilter from "../components/VanTypeFilter";
import { useVansSearchParams } from "../hooks/useVansSearchParams";

export default function VansPage() {
	const vansSearch = useVansSearchParams();
	const { t } = useTranslation();
	const { vans, meta, loading, error, refetch } = useVans({
		params: vansSearch.queryParams,
	});

	if (loading) {
		return <LoadingSpinner />;
	}

	if (error) {
		return <ErrorMessage onRetry={refetch} />;
	}

	return (
		<section className="mx-auto max-w-7xl px-6 py-16 md:py-20">
			<PageHeader eyebrow={t("vans.eyebrow")} title={t("vans.title")} />

			<div className="mb-8 grid gap-5">
				<VansBrowseControls
					search={vansSearch.searchFilter}
					sortChoice={vansSearch.sortChoice}
					onSearchChange={vansSearch.handleSearchChange}
					onSortChoiceChange={vansSearch.handleSortChoiceChange}
				/>
			</div>

			<div className="mb-12 flex flex-wrap items-center justify-between gap-4">
				<VanTypeFilter
					types={[...vanTypes]}
					selectedType={vansSearch.typeFilter}
					onSelect={vansSearch.handleSelectFilter}
				/>

				{vansSearch.hasActiveControls && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={vansSearch.handleClearFilter}
						className="font-semibold text-muted-foreground hover:bg-transparent hover:text-primary"
					>
						{t("vans.clearFilters")}
					</Button>
				)}
			</div>

			{vans.length > 0 ? (
				<div className="grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
					{vans.map((van) => (
						<VanCard
							key={van.id}
							van={van}
							to={van.id}
							state={{
								search: vansSearch.search ? `?${vansSearch.search}` : "",
								type: vansSearch.typeFilter,
							}}
						/>
					))}
				</div>
			) : (
				<EmptyState
					title={t("vans.noVans")}
					message={
						vansSearch.hasActiveControls
							? t("vans.noVansFiltered")
							: t("vans.noVansEmpty")
					}
				/>
			)}

			{meta && (
				<PaginationControls
					ariaLabel={t("vans.paginationAria")}
					page={meta.page}
					totalPages={meta.totalPages}
					total={meta.total}
					totalLabel={t("vans.totalLabel")}
					onPageChange={vansSearch.handlePageChange}
				/>
			)}
		</section>
	);
}
