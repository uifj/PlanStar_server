import { type DateRange, DayPicker } from "@daypicker/react";

interface BookingCalendarProps {
	dateRange?: DateRange;
	onSelect: (range?: DateRange) => void;
}

const bookingCalendarClassNames = {
	months: "flex justify-center",
	month_caption: "mb-4 flex justify-center",
	caption_label: "font-black text-ink text-lg",
	nav: "absolute inset-x-3 top-3 flex items-center justify-between",
	button_previous:
		"grid size-9 place-items-center rounded-lg bg-surface text-muted transition-colors hover:bg-line hover:text-ink disabled:opacity-30",
	button_next:
		"grid size-9 place-items-center rounded-lg bg-surface text-muted transition-colors hover:bg-line hover:text-ink disabled:opacity-30",
	month_grid: "w-full table-fixed border-separate border-spacing-y-1",
	weekday: "pb-2 font-bold text-muted text-xs",
	day_button:
		"mx-auto grid size-9 place-items-center rounded-lg font-bold text-ink text-sm transition-colors hover:bg-surface focus:outline-none focus:ring-2 focus:ring-clay",
	selected:
		"[&>button]:rounded-lg [&>button]:bg-ink [&>button]:text-surface [&>button]:hover:bg-ink [&>button]:hover:text-surface",
	range_middle:
		"[&>button]:rounded-lg [&>button]:bg-clay/20 [&>button]:text-ink [&>button]:hover:bg-clay/30 [&>button]:hover:text-ink",
	disabled: "[&>button]:text-muted/40 [&>button]:hover:bg-transparent",
	hidden: "invisible",
} as const;

export function BookingCalendar({ dateRange, onSelect }: BookingCalendarProps) {
	return (
		<div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-lg bg-panel p-3 sm:p-4">
			<DayPicker
				mode="range"
				selected={dateRange}
				onSelect={onSelect}
				disabled={{ before: new Date() }}
				startMonth={new Date()}
				classNames={bookingCalendarClassNames}
			/>
		</div>
	);
}
