import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import { PaginationControls } from "@/shared/components/PaginationControls";
import VanCard from "@/shared/domain/vans/components/VanCard";
import { useVans } from "@/shared/domain/vans/hooks/useVans";
import { vanTypes } from "@/shared/domain/vans/types";
import VansBrowseControls from "../components/VansBrowseControls";
import VanTypeFilter from "../components/VanTypeFilter";
import { useVansSearchParams } from "../hooks/useVansSearchParams";

export default function VansPage() {
	const vansSearch = useVansSearchParams();
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
			<PageHeader
				eyebrow="Choose your route"
				title="Explore vans ready for weekends, long stays, and detours."
			/>

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
					<button
						type="button"
						onClick={vansSearch.handleClearFilter}
						className="font-semibold text-muted transition-colors hover:text-clay"
					>
						Clear filters
					</button>
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
					title="No vans found"
					message={
						vansSearch.hasActiveControls
							? "There are no vans matching these filters. Clear the filters to browse all available vans."
							: "There are no vans available right now. Please check back soon."
					}
				/>
			)}

			{meta && (
				<PaginationControls
					ariaLabel="Van pages"
					page={meta.page}
					totalPages={meta.totalPages}
					total={meta.total}
					totalLabel="vans"
					onPageChange={vansSearch.handlePageChange}
				/>
			)}
		</section>
	);
}
