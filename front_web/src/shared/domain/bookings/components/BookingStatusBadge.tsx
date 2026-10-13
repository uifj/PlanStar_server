import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/shared/i18n";
import type { BookingStatus } from "../types";

const statusStyles: Record<BookingStatus, string> = {
	pending: "border-status-pending/30 bg-status-pending/15 text-status-pending",
	confirmed:
		"border-status-confirmed/30 bg-status-confirmed/15 text-status-confirmed",
	completed:
		"border-status-completed/30 bg-status-completed/15 text-status-completed",
	cancelled:
		"border-status-cancelled/30 bg-status-cancelled/15 text-status-cancelled",
};

interface BookingStatusBadgeProps {
	status: BookingStatus;
}

export function BookingStatusBadge({ status }: BookingStatusBadgeProps) {
	const { t } = useTranslation();

	return (
		<Badge
			variant="outline"
			className={cn(
				"rounded-lg px-3 py-1 font-bold text-xs capitalize",
				statusStyles[status],
			)}
		>
			{t(`bookings.statuses.${status}`)}
		</Badge>
	);
}
