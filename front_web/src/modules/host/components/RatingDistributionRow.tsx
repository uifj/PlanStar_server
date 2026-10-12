import type { RatingDistribution } from "../types";

interface RatingDistributionRowProps {
	row: RatingDistribution;
}

export function RatingDistributionRow({ row }: RatingDistributionRowProps) {
	return (
		<div className="flex items-center gap-3 font-medium text-muted text-sm">
			<span className="w-14 shrink-0">{row.rating} stars</span>
			<div
				className="h-2 flex-1 overflow-hidden rounded-full bg-panel"
				role="progressbar"
				aria-label={`${row.rating} stars: ${row.percentage}%`}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={row.percentage}
			>
				<div
					className="h-full rounded-full bg-clay"
					style={{ width: `${row.percentage}%` }}
				/>
			</div>
			<span className="w-10 shrink-0 text-right">{row.percentage}%</span>
		</div>
	);
}
