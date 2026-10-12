import { tv, type VariantProps } from "tailwind-variants";
import type { BookingStatus } from "../types";

const bookingStatusBadge = tv({
	base: "rounded-lg border px-3 py-1 font-bold text-xs capitalize",
	variants: {
		status: {
			pending:
				"border-status-pending/30 bg-status-pending/15 text-status-pending",
			confirmed:
				"border-status-confirmed/30 bg-status-confirmed/15 text-status-confirmed",
			completed:
				"border-status-completed/30 bg-status-completed/15 text-status-completed",
			cancelled:
				"border-status-cancelled/30 bg-status-cancelled/15 text-status-cancelled",
		},
	},
});

type BookingStatusBadgeVariants = VariantProps<typeof bookingStatusBadge>;

interface BookingStatusBadgeProps extends BookingStatusBadgeVariants {
	status: BookingStatus;
}

export function BookingStatusBadge({ status }: BookingStatusBadgeProps) {
	return <span className={bookingStatusBadge({ status })}>{status}</span>;
}
