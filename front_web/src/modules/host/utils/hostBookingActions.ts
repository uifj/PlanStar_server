import type { BookingStatus } from "@/shared/domain/bookings/types";
import { formatDateForApi } from "@/shared/domain/bookings/utils/bookingDates";

export type HostBookingActionStatus = Extract<
	BookingStatus,
	"confirmed" | "completed" | "cancelled"
>;

export interface HostBookingAction {
	status: HostBookingActionStatus;
	label: string;
	disabled: boolean;
}

function isBeforeEndDate(endDate: string) {
	const today = formatDateForApi(new Date());

	return today < endDate;
}

export function getHostBookingActions(status: BookingStatus, endDate: string) {
	if (status === "pending") {
		return [
			{ status: "confirmed", label: "host.booking.confirm", disabled: false },
			{ status: "cancelled", label: "host.booking.cancel", disabled: false },
		] satisfies HostBookingAction[];
	}

	if (status === "confirmed") {
		return [
			{
				status: "completed",
				label: "host.booking.complete",
				disabled: isBeforeEndDate(endDate),
			},
			{ status: "cancelled", label: "host.booking.cancel", disabled: false },
		] satisfies HostBookingAction[];
	}

	return [];
}

export function getHostBookingActionHelpText(actions: HostBookingAction[]) {
	const completeAction = actions.find(
		(action) => action.status === "completed",
	);

	if (!completeAction?.disabled) {
		return "";
	}

	return "host.booking.completeAfter";
}
