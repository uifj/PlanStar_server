import type { DateRange } from "@daypicker/react";
import { getDateRangeLabel } from "@/shared/domain/bookings/utils/bookingDates";

interface BookingSummaryProps {
	dateRange?: DateRange;
	nights: number;
	price: number;
	estimatedTotal: number;
}

export function BookingSummary({
	dateRange,
	nights,
	price,
	estimatedTotal,
}: BookingSummaryProps) {
	const dateRangeLabel = getDateRangeLabel(dateRange);
	const nightLabel = nights === 1 ? "night" : "nights";
	const estimatedTotalLabel = estimatedTotal.toLocaleString();

	return (
		<div className="rounded-lg bg-panel p-4">
			<div className="flex items-center justify-between gap-4 font-medium text-muted text-sm">
				<span>Dates</span>
				<span className="text-right">{dateRangeLabel}</span>
			</div>
			<div className="mt-3 flex items-center justify-between gap-4 font-medium text-muted text-sm">
				<span>
					{nights} {nightLabel} x ${price}
				</span>
				<span className="font-black text-ink text-lg">
					${estimatedTotalLabel}
				</span>
			</div>
		</div>
	);
}
