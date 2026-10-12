import type { DateRange } from "@daypicker/react";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
});

export function formatBookingDate(date: Date | string) {
	return dateFormatter.format(new Date(date));
}

export function getDateRangeLabel(dateRange?: DateRange) {
	if (!dateRange?.from) {
		return "Select dates";
	}

	if (!dateRange.to) {
		return formatBookingDate(dateRange.from);
	}

	return `${formatBookingDate(dateRange.from)} - ${formatBookingDate(
		dateRange.to,
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
