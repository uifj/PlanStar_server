import type { ChangeEvent } from "react";
import { FaChevronDown } from "react-icons/fa6";
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
	function handleSortChange(event: ChangeEvent<HTMLSelectElement>) {
		onSortChoiceChange(event.target.value as BookingSortChoice);
	}

	return (
		<div className="grid gap-2">
			<label htmlFor={id} className="font-semibold text-ink text-sm">
				Sort by
			</label>
			<span className="relative">
				<select
					id={id}
					value={sortChoice}
					onChange={handleSortChange}
					className="w-full appearance-none rounded-lg border border-line bg-canvas py-3 pr-11 pl-4 font-semibold text-base text-ink outline-none transition-colors focus:border-clay"
				>
					<option value="newest">Newest requests</option>
					<option value="oldest">Oldest requests</option>
					<option value="soonest-trip">Soonest trip</option>
					<option value="latest-trip">Latest trip</option>
					<option value="highest-total">Highest total</option>
					<option value="lowest-total">Lowest total</option>
				</select>
				<FaChevronDown className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-soft" />
			</span>
		</div>
	);
}
