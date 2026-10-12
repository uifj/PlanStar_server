import { formatBookingDate } from "./bookingDates";

export function getBookingDateRange(startDate: string, endDate: string) {
	return `${formatBookingDate(startDate)} - ${formatBookingDate(endDate)}`;
}

export function getGuestLabel(guests: number) {
	return guests === 1 ? "1 guest" : `${guests} guests`;
}
