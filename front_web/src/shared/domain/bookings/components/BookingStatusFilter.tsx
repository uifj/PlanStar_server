import { tv } from "tailwind-variants";
import { bookingStatusFilters } from "../queryControls";
import type { BookingStatus } from "../types";

const statusButton = tv({
	base: "rounded-lg bg-panel px-4 py-2 font-semibold text-sm capitalize transition-colors active:scale-95",
	variants: {
		selected: {
			true: "bg-ink text-surface",
			false: "text-muted hover:bg-sage hover:text-surface",
		},
	},
});

interface BookingStatusFilterProps {
	selectedStatus: BookingStatus | null;
	onSelect(status: BookingStatus): void;
}

export function BookingStatusFilter({
	selectedStatus,
	onSelect,
}: BookingStatusFilterProps) {
	return (
		<div className="flex flex-wrap gap-3">
			{bookingStatusFilters.map((status) => {
				const selected = selectedStatus === status;

				return (
					<button
						key={status}
						type="button"
						aria-pressed={selected}
						onClick={() => onSelect(status)}
						className={statusButton({ selected })}
					>
						{status}
					</button>
				);
			})}
		</div>
	);
}
