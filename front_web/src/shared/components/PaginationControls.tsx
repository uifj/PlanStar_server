import { FaChevronLeft, FaChevronRight } from "react-icons/fa6";

interface PaginationControlsProps {
	page: number;
	totalPages: number;
	total: number;
	totalLabel: string;
	ariaLabel: string;
	onPageChange(page: number): void;
}

export function PaginationControls({
	page,
	totalPages,
	total,
	totalLabel,
	ariaLabel,
	onPageChange,
}: PaginationControlsProps) {
	const canGoBack = page > 1;
	const canGoForward = page < totalPages;

	function handlePreviousPage() {
		if (canGoBack) {
			onPageChange(page - 1);
		}
	}

	function handleNextPage() {
		if (canGoForward) {
			onPageChange(page + 1);
		}
	}

	if (totalPages <= 1) {
		return null;
	}

	return (
		<nav
			aria-label={ariaLabel}
			className="mt-10 flex flex-col gap-4 border-line border-t pt-6 sm:flex-row sm:items-center sm:justify-between"
		>
			<p className="font-medium text-muted">
				Page <span className="text-ink">{page}</span> of{" "}
				<span className="text-ink">{totalPages}</span>
				<span className="text-soft">
					{" "}
					· {total} {totalLabel}
				</span>
			</p>

			<div className="flex gap-3">
				<button
					type="button"
					onClick={handlePreviousPage}
					disabled={!canGoBack}
					className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-3 font-semibold text-ink transition-colors hover:border-clay hover:text-clay disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink"
				>
					<FaChevronLeft aria-hidden="true" />
					Previous
				</button>

				<button
					type="button"
					onClick={handleNextPage}
					disabled={!canGoForward}
					className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-3 font-semibold text-ink transition-colors hover:border-clay hover:text-clay disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink"
				>
					Next
					<FaChevronRight aria-hidden="true" />
				</button>
			</div>
		</nav>
	);
}
