import { FaStar } from "react-icons/fa6";
import { cn } from "tailwind-variants";

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
	const label = `${option} ${option === 1 ? "star" : "stars"}`;
	const starClassName = cn(option <= rating ? "text-clay" : "text-line");

	function handleClick() {
		onChange(option);
	}

	return (
		<button
			type="button"
			aria-pressed={option === rating}
			onClick={handleClick}
			disabled={disabled}
			aria-label={label}
			className="rounded-md p-1 text-clay transition-colors hover:bg-clay/10 focus:outline-none focus:ring-2 focus:ring-clay disabled:text-line"
		>
			<FaStar aria-hidden="true" className={starClassName} />
		</button>
	);
}
