import { FaStar } from "react-icons/fa6";
import { cn } from "tailwind-variants";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/shared/i18n";

interface RatingButtonProps {
	option: number;
	rating: number;
	disabled: boolean;
	onChange: (rating: number) => void;
}

export function RatingButton({
	option,
	rating,
	disabled,
	onChange,
}: RatingButtonProps) {
	const { t } = useTranslation();
	const label = t(
		option === 1 ? "bookings.starSingular" : "bookings.starPlural",
		{ count: option },
	);
	const starClassName = cn(option <= rating ? "text-primary" : "text-border");

	function handleClick() {
		onChange(option);
	}

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			aria-pressed={option === rating}
			onClick={handleClick}
			disabled={disabled}
			aria-label={label}
			className="rounded-md text-primary hover:bg-primary/10 hover:text-primary disabled:text-border"
		>
			<FaStar aria-hidden="true" className={starClassName} />
		</Button>
	);
}
