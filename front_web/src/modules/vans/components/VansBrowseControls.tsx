import type { ChangeEvent } from "react";
import { FaChevronDown, FaMagnifyingGlass } from "react-icons/fa6";
import type { VansSortChoice } from "../queryControls";

interface VansBrowseControlsProps {
	search: string;
	sortChoice: VansSortChoice;
	onSearchChange(value: string): void;
	onSortChoiceChange(value: VansSortChoice): void;
}

export default function VansBrowseControls({
	search,
	sortChoice,
	onSearchChange,
	onSortChoiceChange,
}: VansBrowseControlsProps) {
	function handleSearchChange(event: ChangeEvent<HTMLInputElement>) {
		onSearchChange(event.target.value);
	}

	function handleSortChange(event: ChangeEvent<HTMLSelectElement>) {
		onSortChoiceChange(event.target.value as VansSortChoice);
	}

	return (
		<div className="grid gap-4 rounded-xl border border-line bg-surface p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] md:items-end">
			<div className="grid gap-2">
				<label htmlFor="vans-search" className="font-semibold text-ink text-sm">
					Search vans
				</label>
				<span className="relative">
					<FaMagnifyingGlass className="absolute top-1/2 left-4 -translate-y-1/2 text-soft" />
					<input
						id="vans-search"
						type="search"
						value={search}
						onChange={handleSearchChange}
						placeholder="Name, location, or description"
						className="w-full rounded-lg border border-line bg-canvas py-3 pr-4 pl-11 font-medium text-base text-ink outline-none transition-colors placeholder:text-soft focus:border-clay"
					/>
				</span>
			</div>

			<div className="grid gap-2">
				<label htmlFor="vans-sort" className="font-semibold text-ink text-sm">
					Sort by
				</label>
				<span className="relative">
					<select
						id="vans-sort"
						value={sortChoice}
						onChange={handleSortChange}
						className="w-full appearance-none rounded-lg border border-line bg-canvas py-3 pr-11 pl-4 font-semibold text-base text-ink outline-none transition-colors focus:border-clay"
					>
						<option value="newest">Newest vans</option>
						<option value="oldest">Oldest vans</option>
						<option value="highest-price">Highest price</option>
						<option value="lowest-price">Lowest price</option>
						<option value="highest-rating">Highest rating</option>
						<option value="lowest-rating">Lowest rating</option>
						<option value="name-a-z">Name A to Z</option>
						<option value="name-z-a">Name Z to A</option>
					</select>
					<FaChevronDown className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-soft" />
				</span>
			</div>
		</div>
	);
}
