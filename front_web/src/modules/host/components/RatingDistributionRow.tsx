import { useTranslation } from "@/shared/i18n";
import type { RatingDistribution } from "../types";

interface RatingDistributionRowProps {
	row: RatingDistribution;
}

export function RatingDistributionRow({ row }: RatingDistributionRowProps) {
	const { t } = useTranslation();

	return (
		<div className="flex items-center gap-3 font-medium text-muted-foreground text-sm">
			<span className="w-14 shrink-0">
				{t("host.reviews.stars", { rating: row.rating })}
			</span>
			<div
				className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"
				role="progressbar"
				aria-label={t("host.reviews.starsPercent", {
					rating: row.rating,
					percentage: row.percentage,
				})}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={row.percentage}
			>
				<div
					className="h-full rounded-full bg-primary"
					style={{ width: `${row.percentage}%` }}
				/>
			</div>
			<span className="w-10 shrink-0 text-right">{row.percentage}%</span>
		</div>
	);
}
