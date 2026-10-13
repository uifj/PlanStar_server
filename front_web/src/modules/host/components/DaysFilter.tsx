import { Button } from "@/components/ui/button";
import { useTranslation } from "@/shared/i18n";

const dayOptions = [30, 90, 365] as const;

interface DaysFilterProps {
	value: number;
	onChange: (days: number) => void;
}

export function DaysFilter({ value, onChange }: DaysFilterProps) {
	const { t } = useTranslation();

	return (
		<fieldset className="flex flex-wrap items-center gap-2">
			<legend className="sr-only">{t("host.daysFilter.label")}</legend>
			{dayOptions.map((days) => (
				<Button
					key={days}
					type="button"
					variant={days === value ? "default" : "secondary"}
					onClick={() => onChange(days)}
					className={
						days === value
							? "bg-foreground text-card hover:bg-foreground/90"
							: "font-bold text-foreground hover:bg-border"
					}
				>
					{t("host.daysFilter.days", { days })}
				</Button>
			))}
		</fieldset>
	);
}
