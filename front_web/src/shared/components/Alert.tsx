import type { ReactNode } from "react";
import { FaCircleInfo, FaTriangleExclamation } from "react-icons/fa6";
import { tv, type VariantProps } from "tailwind-variants";

const alert = tv({
	slots: {
		base: "flex w-full items-start gap-3 rounded-lg border border-l-4 px-4 py-3",
		icon: "mt-0.5 shrink-0 text-sm",
		text: "font-medium text-sm leading-6",
	},
	variants: {
		variant: {
			info: {
				base: "border-line border-l-sage bg-panel",
				icon: "text-clay",
				text: "text-ink",
			},
			error: {
				base: "border-line border-l-clay bg-surface",
				icon: "text-clay-dark",
				text: "text-ink",
			},
		},
	},
	defaultVariants: {
		variant: "info",
	},
});

type AlertVariants = VariantProps<typeof alert>;

interface AlertProps extends AlertVariants {
	children: ReactNode;
}

export function Alert({ variant, children }: AlertProps) {
	const { base, icon, text } = alert({ variant });

	const Icon = variant === "error" ? FaTriangleExclamation : FaCircleInfo;

	return (
		<div
			role={variant === "error" ? "alert" : "status"}
			aria-live={variant === "error" ? "assertive" : "polite"}
			className={base()}
		>
			<Icon aria-hidden className={icon()} />
			<p className={text()}>{children}</p>
		</div>
	);
}
