import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/shared/i18n";
import { bookingStatusFilters } from "../queryControls";
import type { BookingStatus } from "../types";

interface BookingStatusFilterProps {
	selectedStatus: BookingStatus | null;
	onSelect(status: BookingStatus): void;
}

export function BookingStatusFilter({
	selectedStatus,
	onSelect,
}: BookingStatusFilterProps) {
	const { t } = useTranslation();

	return (
		<div className="flex flex-wrap gap-3">
			{bookingStatusFilters.map((status) => {
				const selected = selectedStatus === status;

				return (
					<Button
						key={status}
						type="button"
						variant="secondary"
						aria-pressed={selected}
						onClick={() => onSelect(status)}
						className={cn(
							"h-auto px-4 py-2 font-semibold text-sm capitalize",
							selected
								? "bg-foreground text-card hover:bg-foreground"
								: "text-muted-foreground hover:bg-sage hover:text-card",
						)}
					>
						{t(`bookings.statuses.${status}`)}
					</Button>
				);
			})}
		</div>
	);
}
