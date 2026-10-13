import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VanType } from "@/shared/domain/vans/types";
import { useTranslation } from "@/shared/i18n";

const activeTypeStyle: Record<VanType, string> = {
	simple: "bg-primary hover:bg-primary",
	luxury: "bg-foreground hover:bg-foreground",
	rugged: "bg-sage hover:bg-sage",
};

const hoverTypeStyle: Record<VanType, string> = {
	simple: "hover:bg-primary",
	luxury: "hover:bg-foreground",
	rugged: "hover:bg-sage",
};

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
	const { t } = useTranslation();

	return (
		<div className="flex flex-wrap gap-3">
			{types.map((type) => {
				const selected = selectedType === type;

				return (
					<Button
						key={type}
						type="button"
						variant="secondary"
						aria-pressed={selected}
						onClick={() => onSelect(type)}
						className={cn(
							"h-auto px-5 py-2 font-semibold text-base capitalize",
							selected
								? cn("text-card", activeTypeStyle[type])
								: cn(
										"text-muted-foreground hover:text-card",
										hoverTypeStyle[type],
									),
						)}
					>
						{t(`vans.type.${type}`)}
					</Button>
				);
			})}
		</div>
	);
}
