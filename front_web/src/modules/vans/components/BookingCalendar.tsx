import { type DateRange, DayPicker } from "@daypicker/react";
import { enUS } from "date-fns/locale/en-US";
import { zhCN } from "date-fns/locale/zh-CN";
import { useTranslation } from "@/shared/i18n";

interface BookingCalendarProps {
	dateRange?: DateRange;
	onSelect: (range?: DateRange) => void;
}

const bookingCalendarClassNames = {
	months: "flex justify-center",
	month_caption: "mb-4 flex justify-center",
	caption_label: "font-black text-foreground text-lg",
	nav: "absolute inset-x-3 top-3 flex items-center justify-between",
	button_previous:
		"grid size-9 place-items-center rounded-lg bg-card text-muted-foreground transition-colors hover:bg-border hover:text-foreground disabled:opacity-30",
	button_next:
		"grid size-9 place-items-center rounded-lg bg-card text-muted-foreground transition-colors hover:bg-border hover:text-foreground disabled:opacity-30",
	month_grid: "w-full table-fixed border-separate border-spacing-y-1",
	weekday: "pb-2 font-bold text-muted-foreground text-xs",
	day_button:
		"mx-auto grid size-9 place-items-center rounded-lg font-bold text-foreground text-sm transition-colors hover:bg-card focus:outline-none focus:ring-2 focus:ring-ring",
	selected:
		"[&>button]:rounded-lg [&>button]:bg-foreground [&>button]:text-card [&>button]:hover:bg-foreground [&>button]:hover:text-card",
	range_middle:
		"[&>button]:rounded-lg [&>button]:bg-primary/20 [&>button]:text-foreground [&>button]:hover:bg-primary/30 [&>button]:hover:text-foreground",
	disabled:
		"[&>button]:text-muted-foreground/40 [&>button]:hover:bg-transparent",
	hidden: "invisible",
} as const;

export function BookingCalendar({ dateRange, onSelect }: BookingCalendarProps) {
	const { language } = useTranslation();

	return (
		<div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-lg bg-secondary p-3 sm:p-4">
			<DayPicker
				mode="range"
				selected={dateRange}
				onSelect={onSelect}
				disabled={{ before: new Date() }}
				startMonth={new Date()}
				locale={language === "zh" ? zhCN : enUS}
				classNames={bookingCalendarClassNames}
			/>
		</div>
	);
}
