import { Button } from "@/components/ui/button";
import { Alert } from "@/shared/components/Alert";
import type { BookingStatus } from "@/shared/domain/bookings/types";
import { useTranslation } from "@/shared/i18n";
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
	const { t } = useTranslation();
	const { updateStatus, loading, error } = useUpdateHostBookingStatus();
	const actions = getHostBookingActions(status, endDate);
	const helpText = getHostBookingActionHelpText(actions);

	function handleSelectStatus(nextStatus: HostBookingActionStatus) {
		updateStatus({ id: bookingId, status: nextStatus });
	}

	if (actions.length === 0) {
		return null;
	}

	return (
		<div className="mt-5 grid gap-3 border-border border-t pt-4">
			<div className="flex flex-wrap gap-3">
				{actions.map((action) => (
					<Button
						key={action.status}
						type="button"
						variant="outline"
						onClick={() => handleSelectStatus(action.status)}
						disabled={loading || action.disabled}
					>
						{loading ? t("host.booking.updating") : t(action.label)}
					</Button>
				))}
			</div>

			{helpText ? (
				<p className="font-medium text-muted-foreground text-sm">
					{t(helpText, { endDate })}
				</p>
			) : null}

			{error ? <Alert variant="error">{error.message}</Alert> : null}
		</div>
	);
}
