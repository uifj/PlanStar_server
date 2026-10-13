import type { DateRange } from "@daypicker/react";
import { getDateRangeLabel } from "@/shared/domain/bookings/utils/bookingDates";
import { LANGUAGE_LOCALES, useTranslation } from "@/shared/i18n";

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
	const { t, language } = useTranslation();
	const dateRangeLabel = dateRange?.from
		? getDateRangeLabel(dateRange, t, LANGUAGE_LOCALES[language])
		: t("vans.selectDates");
	const nightLabel =
		nights === 1 ? t("vans.nightSingular") : t("vans.nightPlural");
	const estimatedTotalLabel = estimatedTotal.toLocaleString();

	return (
		<div className="rounded-lg bg-secondary p-4">
			<div className="flex items-center justify-between gap-4 font-medium text-muted-foreground text-sm">
				<span>{t("vans.dates")}</span>
				<span className="text-right">{dateRangeLabel}</span>
			</div>
			<div className="mt-3 flex items-center justify-between gap-4 font-medium text-muted-foreground text-sm">
				<span>
					{nights} {nightLabel} x ${price}
				</span>
				<span className="font-black text-foreground text-lg">
					${estimatedTotalLabel}
				</span>
			</div>
		</div>
	);
}
