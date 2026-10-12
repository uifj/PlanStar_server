const dayOptions = [30, 90, 365] as const;

interface DaysFilterProps {
	value: number;
	onChange: (days: number) => void;
}

export function DaysFilter({ value, onChange }: DaysFilterProps) {
	return (
		<fieldset className="flex flex-wrap items-center gap-2">
			<legend className="sr-only">Date range</legend>
			{dayOptions.map((days) => (
				<button
					key={days}
					type="button"
					onClick={() => onChange(days)}
					className={
						days === value
							? "rounded-lg bg-ink px-4 py-2 font-bold text-sm text-surface transition-colors"
							: "rounded-lg bg-panel px-4 py-2 font-bold text-ink text-sm transition-colors hover:bg-line"
					}
				>
					{days} days
				</button>
			))}
		</fieldset>
	);
}
