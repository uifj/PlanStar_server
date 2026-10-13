import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/shared/i18n";

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
	const { t } = useTranslation();
	const canGoBack = page > 1;
	const canGoForward = page < totalPages;

	if (totalPages <= 1) {
		return null;
	}

	return (
		<nav
			aria-label={ariaLabel}
			className="mt-10 flex flex-col gap-4 border-border border-t pt-6 sm:flex-row sm:items-center sm:justify-between"
		>
			<p className="font-medium text-muted-foreground">
				{t("pagination.pageOf", { page, totalPages })}
				<span className="text-soft">
					{" "}
					· {total} {totalLabel}
				</span>
			</p>

			<div className="flex gap-3">
				<Button
					type="button"
					variant="outline"
					onClick={() => canGoBack && onPageChange(page - 1)}
					disabled={!canGoBack}
				>
					<ChevronLeft aria-hidden="true" />
					{t("pagination.previous")}
				</Button>

				<Button
					type="button"
					variant="outline"
					onClick={() => canGoForward && onPageChange(page + 1)}
					disabled={!canGoForward}
				>
					{t("pagination.next")}
					<ChevronRight aria-hidden="true" />
				</Button>
			</div>
		</nav>
	);
}
