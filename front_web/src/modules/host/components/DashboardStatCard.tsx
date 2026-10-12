import { tv, type VariantProps } from "tailwind-variants";

const dashboardStatCard = tv({
	base: "rounded-xl p-6 shadow-sm",
	variants: {
		variant: {
			light: "bg-surface",
			panel: "bg-panel",
			dark: "bg-ink",
		},
	},
	defaultVariants: {
		variant: "light",
	},
});

const dashboardStatLabel = tv({
	base: "font-semibold text-sm",
	variants: {
		variant: {
			light: "text-muted",
			panel: "text-muted",
			dark: "text-panel",
		},
	},
});

const dashboardStatValue = tv({
	base: "mt-3 font-black text-4xl",
	variants: {
		variant: {
			light: "text-ink",
			panel: "text-ink",
			dark: "text-surface",
		},
	},
});

const dashboardStatDescription = tv({
	base: "mt-2 font-medium text-sm",
	variants: {
		variant: {
			light: "text-muted",
			panel: "text-muted",
			dark: "text-panel",
		},
	},
});

type DashboardStatCardVariants = VariantProps<typeof dashboardStatCard>;

interface DashboardStatCardProps extends DashboardStatCardVariants {
	label: string;
	value: string | number;
	description: string;
}

export function DashboardStatCard({
	label,
	value,
	description,
	variant,
}: DashboardStatCardProps) {
	return (
		<article className={dashboardStatCard({ variant })}>
			<p className={dashboardStatLabel({ variant })}>{label}</p>
			<p className={dashboardStatValue({ variant })}>{value}</p>
			<p className={dashboardStatDescription({ variant })}>{description}</p>
		</article>
	);
}
