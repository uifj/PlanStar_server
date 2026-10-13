import { Button } from "@/components/ui/button";
import { useTranslation } from "@/shared/i18n";
import { useCancelBooking } from "../hooks/useCancelBooking";

interface CancelBookingButtonProps {
	bookingId: string;
}

export function CancelBookingButton({ bookingId }: CancelBookingButtonProps) {
	const { cancelBooking, loading, error } = useCancelBooking();
	const { t } = useTranslation();
	const buttonText = loading
		? t("bookings.cancelling")
		: t("bookings.cancelBooking");

	function handleCancel() {
		cancelBooking(bookingId);
	}

	return (
		<div>
			<Button
				type="button"
				variant="outline"
				onClick={handleCancel}
				disabled={loading}
				className="border-status-cancelled/30 text-status-cancelled hover:bg-status-cancelled/10 hover:text-status-cancelled"
			>
				{buttonText}
			</Button>

			{error ? (
				<p className="mt-2 font-semibold text-sm text-status-cancelled">
					{error.message}
				</p>
			) : null}
		</div>
	);
}
