export function formatShortDate(date: string) {
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
	}).format(new Date(`${date}T00:00:00`));
}

function parsePeriod(period: string) {
	const [year = "", month = ""] = period.split("-");

	return new Date(Number(year), Number(month) - 1);
}

export function hasMultipleYears(periods: { period: string }[]) {
	const years = new Set(periods.map((item) => item.period.split("-")[0]));

	return years.size > 1;
}

export function formatPeriod(period: string, showYear: boolean) {
	const date = parsePeriod(period);

	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		year: showYear ? "2-digit" : undefined,
	}).format(date);
}
