import type { DateRange } from "@daypicker/react";
import { type SubmitEvent, useState } from "react";
import {
	formatDateForApi,
	getNightCount,
} from "@/shared/domain/bookings/utils/bookingDates";
import type { VanDetail } from "@/shared/domain/vans/types";
import { useTranslation } from "@/shared/i18n";
import { useCreateBooking } from "./useCreateBooking";

type BookingPanelVan = Pick<VanDetail, "id" | "name" | "price">;
type BookingStatusVariant = "ready" | "error" | "success";

export function useBookingPanel(van: BookingPanelVan) {
	const [dateRange, setDateRange] = useState<DateRange>();
	const [guests, setGuests] = useState(1);
	const { createBooking, booking, loading, error, success, reset } =
		useCreateBooking();
	const { t } = useTranslation();

	const nights = getNightCount(dateRange?.from, dateRange?.to);
	const estimatedTotal = nights * van.price;
	const canSubmit = Boolean(
		dateRange?.from && dateRange.to && nights > 0 && !success,
	);
	const statusMessage =
		error?.message ||
		(success && booking
			? t("vans.bookingSuccess", {
					name: van.name,
					total: `$${booking.totalPrice.toLocaleString()}`,
				})
			: canSubmit
				? t("vans.datesSelected")
				: "");
	const statusVariant: BookingStatusVariant =
		success && booking ? "success" : error ? "error" : "ready";
	const submitButtonText = loading
		? t("vans.sendingRequest")
		: success
			? t("vans.requestSent")
			: t("vans.requestBooking");

	function handleDateSelect(range?: DateRange) {
		if (success || error) {
			reset();
		}

		setDateRange(range);
	}

	function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!dateRange?.from || !dateRange.to || nights === 0) {
			return;
		}

		reset();
		createBooking({
			vanId: van.id,
			startDate: formatDateForApi(dateRange.from),
			endDate: formatDateForApi(dateRange.to),
			guests,
		});
	}

	return {
		dateRange,
		guests,
		nights,
		estimatedTotal,
		canSubmit,
		loading,
		statusMessage,
		statusVariant,
		submitButtonText,
		handleDateSelect,
		handleGuestChange: setGuests,
		handleSubmit,
	};
}
