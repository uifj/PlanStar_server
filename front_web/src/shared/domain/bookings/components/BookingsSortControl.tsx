import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/shared/i18n";
import type { BookingSortChoice } from "../types";

interface BookingsSortControlProps {
	id: string;
	sortChoice: BookingSortChoice;
	onSortChoiceChange(sortChoice: BookingSortChoice): void;
}

export function BookingsSortControl({
	id,
	sortChoice,
	onSortChoiceChange,
}: BookingsSortControlProps) {
	const { t } = useTranslation();

	return (
		<div className="grid gap-2">
			<label htmlFor={id} className="font-semibold text-foreground text-sm">
				{t("bookings.sortLabel")}
			</label>
			<Select
				value={sortChoice}
				onValueChange={(value) =>
					onSortChoiceChange(value as BookingSortChoice)
				}
			>
				<SelectTrigger id={id} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="newest">
						{t("bookings.sortOptions.newest")}
					</SelectItem>
					<SelectItem value="oldest">
						{t("bookings.sortOptions.oldest")}
					</SelectItem>
					<SelectItem value="soonest-trip">
						{t("bookings.sortOptions.soonestTrip")}
					</SelectItem>
					<SelectItem value="latest-trip">
						{t("bookings.sortOptions.latestTrip")}
					</SelectItem>
					<SelectItem value="highest-total">
						{t("bookings.sortOptions.highestTotal")}
					</SelectItem>
					<SelectItem value="lowest-total">
						{t("bookings.sortOptions.lowestTotal")}
					</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}
