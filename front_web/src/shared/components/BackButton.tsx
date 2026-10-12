import { FaArrowLeft } from "react-icons/fa6";
import { Link, type To } from "react-router";
import { cn } from "tailwind-variants";

interface BackButtonProps {
	text?: string;
	to: To;
	className?: string;
}

export function BackButton({ text = "Back", to, className }: BackButtonProps) {
	return (
		<Link
			to={to}
			relative="path"
			className={cn(
				"inline-flex items-center gap-3",
				"font-semibold text-base text-muted",
				"transition-colors hover:text-clay",
				className,
			)}
		>
			<FaArrowLeft className="text-soft" />
			{text}
		</Link>
	);
}
