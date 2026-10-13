import type { DateRange } from "@daypicker/react";
import type { TranslateParams } from "@/shared/i18n";

type Translate = (key: string, params?: TranslateParams) => string;

function createDateFormatter(locale: string) {
	return new Intl.DateTimeFormat(locale, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

const enUsDateFormatter = createDateFormatter("en-US");

export function formatBookingDate(date: Date | string, locale = "en-US") {
	const formatter =
		locale === "en-US" ? enUsDateFormatter : createDateFormatter(locale);

	return formatter.format(new Date(date));
}

export function getDateRangeLabel(
	dateRange?: DateRange,
	t?: Translate,
	locale = "en-US",
) {
	if (!dateRange?.from) {
		return t ? t("bookings.selectDates") : "Select dates";
	}

	if (!dateRange.to) {
		return formatBookingDate(dateRange.from, locale);
	}

	return `${formatBookingDate(dateRange.from, locale)} - ${formatBookingDate(
		dateRange.to,
		locale,
	)}`;
}

export function formatDateForApi(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");

	return `${year}-${month}-${day}`;
}

export function getNightCount(startDate?: Date, endDate?: Date) {
	if (!startDate || !endDate) {
		return 0;
	}

	const millisecondsPerDay = 1000 * 60 * 60 * 24;
	const startTime = startDate.getTime();
	const endTime = endDate.getTime();

	return Math.max(0, Math.round((endTime - startTime) / millisecondsPerDay));
}
