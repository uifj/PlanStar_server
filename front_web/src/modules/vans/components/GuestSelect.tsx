import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/shared/i18n";

interface GuestSelectProps {
	guestLimit: number;
	guests: number;
	onChange: (guests: number) => void;
}

export function GuestSelect({
	guestLimit,
	guests,
	onChange,
}: GuestSelectProps) {
	const { t } = useTranslation();
	const guestOptions = Array.from(
		{ length: guestLimit },
		(_, index) => index + 1,
	);

	return (
		<div className="grid gap-2">
			<label
				htmlFor="booking-guests"
				className="font-semibold text-foreground text-sm"
			>
				{t("vans.guestsLabel")}
			</label>
			<Select
				value={String(guests)}
				onValueChange={(value) => onChange(Number(value))}
			>
				<SelectTrigger id="booking-guests" className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{guestOptions.map((guestCount) => (
						<SelectItem key={guestCount} value={String(guestCount)}>
							{guestCount}{" "}
							{guestCount === 1
								? t("vans.guestSingular")
								: t("vans.guestPlural")}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
