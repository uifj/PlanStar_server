import { tv } from "tailwind-variants";
import type { VanType } from "@/shared/domain/vans/types";

const vanTypeButton = tv({
	base: "rounded-lg bg-panel px-5 py-2 font-semibold text-base capitalize transition-colors active:scale-95",
	variants: {
		selected: {
			true: "text-surface",
			false: "text-muted",
		},
		type: {
			simple: "hover:bg-clay hover:text-surface aria-pressed:bg-clay",
			luxury: "hover:bg-ink hover:text-surface aria-pressed:bg-ink",
			rugged: "hover:bg-sage hover:text-surface aria-pressed:bg-sage",
		},
	},
});

interface VanTypeFilterProps {
	types: VanType[];
	selectedType: string | null;
	onSelect(type: VanType): void;
}

export default function VanTypeFilter({
	types,
	selectedType,
	onSelect,
}: VanTypeFilterProps) {
	return (
		<div className="flex flex-wrap gap-3">
			{types.map((type) => {
				return (
					<button
						key={type}
						type="button"
						aria-pressed={selectedType === type}
						onClick={() => onSelect(type)}
						className={vanTypeButton({
							selected: selectedType === type,
							type,
						})}
					>
						{type}
					</button>
				);
			})}
		</div>
	);
}
