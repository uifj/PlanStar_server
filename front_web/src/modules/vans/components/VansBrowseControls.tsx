import type { ChangeEvent } from "react";
import { FaMagnifyingGlass } from "react-icons/fa6";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/shared/i18n";
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
	const { t } = useTranslation();

	function handleSearchChange(event: ChangeEvent<HTMLInputElement>) {
		onSearchChange(event.target.value);
	}

	return (
		<div className="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] md:items-end">
			<div className="grid gap-2">
				<label
					htmlFor="vans-search"
					className="font-semibold text-foreground text-sm"
				>
					{t("vans.searchVans")}
				</label>
				<span className="relative">
					<FaMagnifyingGlass className="absolute top-1/2 left-4 -translate-y-1/2 text-soft" />
					<Input
						id="vans-search"
						type="search"
						value={search}
						onChange={handleSearchChange}
						placeholder={t("vans.searchPlaceholder")}
						className="h-auto rounded-lg border-border bg-background py-3 pr-4 pl-11 font-medium placeholder:text-soft"
					/>
				</span>
			</div>

			<div className="grid gap-2">
				<label
					htmlFor="vans-sort"
					className="font-semibold text-foreground text-sm"
				>
					{t("vans.sortBy")}
				</label>
				<Select
					value={sortChoice}
					onValueChange={(value) => onSortChoiceChange(value as VansSortChoice)}
				>
					<SelectTrigger id="vans-sort" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="newest">{t("vans.sortNewest")}</SelectItem>
						<SelectItem value="oldest">{t("vans.sortOldest")}</SelectItem>
						<SelectItem value="highest-price">
							{t("vans.sortHighestPrice")}
						</SelectItem>
						<SelectItem value="lowest-price">
							{t("vans.sortLowestPrice")}
						</SelectItem>
						<SelectItem value="highest-rating">
							{t("vans.sortHighestRating")}
						</SelectItem>
						<SelectItem value="lowest-rating">
							{t("vans.sortLowestRating")}
						</SelectItem>
						<SelectItem value="name-a-z">{t("vans.sortNameAZ")}</SelectItem>
						<SelectItem value="name-z-a">{t("vans.sortNameZA")}</SelectItem>
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}
