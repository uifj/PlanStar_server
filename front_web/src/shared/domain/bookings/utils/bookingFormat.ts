import type { TranslateParams } from "@/shared/i18n";
import { formatBookingDate } from "./bookingDates";

type Translate = (key: string, params?: TranslateParams) => string;

export function getBookingDateRange(
	startDate: string,
	endDate: string,
	locale = "en-US",
) {
	return `${formatBookingDate(startDate, locale)} - ${formatBookingDate(
		endDate,
		locale,
	)}`;
}

export function getGuestLabel(guests: number, t?: Translate) {
	if (!t) {
		return guests === 1 ? "1 guest" : `${guests} guests`;
	}

	return guests === 1
		? t("bookings.guestSingular")
		: t("bookings.guestsPlural", { count: guests });
}
