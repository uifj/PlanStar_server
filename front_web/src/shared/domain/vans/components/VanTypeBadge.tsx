import { tv } from "tailwind-variants";
import type { VanType } from "../types";

const vanTypeBadge = tv({
	base: "shrink-0 rounded-md px-3 py-1 font-semibold text-sm text-surface capitalize",
	variants: {
		type: {
			simple: "bg-clay",
			luxury: "bg-ink",
			rugged: "bg-sage",
		},
	},
});

interface VanTypeBadgeProps {
	type: VanType;
	className?: string;
}

export default function VanTypeBadge({ type, className }: VanTypeBadgeProps) {
	return (
		<span
			className={vanTypeBadge({
				type,
				className,
			})}
		>
			{type}
		</span>
	);
}
