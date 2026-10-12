import { Alert } from "@/shared/components/Alert";
import type { BookingStatus } from "@/shared/domain/bookings/types";
import { useUpdateHostBookingStatus } from "../hooks/useUpdateHostBookingStatus";
import {
	getHostBookingActionHelpText,
	getHostBookingActions,
	type HostBookingActionStatus,
} from "../utils/hostBookingActions";

interface HostBookingActionsProps {
	bookingId: string;
	status: BookingStatus;
	endDate: string;
}

export function HostBookingActions({
	bookingId,
	status,
	endDate,
}: HostBookingActionsProps) {
	const { updateStatus, loading, error } = useUpdateHostBookingStatus();
	const actions = getHostBookingActions(status, endDate);
	const helpText = getHostBookingActionHelpText(actions, endDate);

	function handleSelectStatus(nextStatus: HostBookingActionStatus) {
		updateStatus({ id: bookingId, status: nextStatus });
	}

	if (actions.length === 0) {
		return null;
	}

	return (
		<div className="mt-5 grid gap-3 border-line border-t pt-4">
			<div className="flex flex-wrap gap-3">
				{actions.map((action) => (
					<button
						key={action.status}
						type="button"
						onClick={() => handleSelectStatus(action.status)}
						disabled={loading || action.disabled}
						className="rounded-lg border border-line px-4 py-2 font-bold text-ink text-sm transition-colors hover:border-clay hover:text-clay active:scale-95 disabled:text-muted disabled:hover:border-line"
					>
						{loading ? "Updating..." : action.label}
					</button>
				))}
			</div>

			{helpText ? (
				<p className="font-medium text-muted text-sm">{helpText}</p>
			) : null}

			{error ? <Alert variant="error">{error.message}</Alert> : null}
		</div>
	);
}
