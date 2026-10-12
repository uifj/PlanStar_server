import { useCancelBooking } from "../hooks/useCancelBooking";

interface CancelBookingButtonProps {
	bookingId: string;
}

export function CancelBookingButton({ bookingId }: CancelBookingButtonProps) {
	const { cancelBooking, loading, error } = useCancelBooking();
	const buttonText = loading ? "Cancelling..." : "Cancel booking";

	function handleCancel() {
		cancelBooking(bookingId);
	}

	return (
		<div>
			<button
				type="button"
				onClick={handleCancel}
				disabled={loading}
				className="rounded-lg border border-status-cancelled/30 px-4 py-2 font-bold text-sm text-status-cancelled transition-colors hover:bg-status-cancelled/10 active:scale-95 disabled:border-line disabled:text-muted"
			>
				{buttonText}
			</button>

			{error ? (
				<p className="mt-2 font-semibold text-sm text-status-cancelled">
					{error.message}
				</p>
			) : null}
		</div>
	);
}
