import { NavLink } from "react-router";
import { tv, type VariantProps } from "tailwind-variants";
import type { NavItem } from "../utils/types";

const nav = tv({
	base: "flex items-center text-muted-foreground",
	variants: {
		variant: {
			primary: "gap-6 font-semibold text-base",
			secondary: "gap-5 font-medium text-sm",
		},
	},
	defaultVariants: {
		variant: "primary",
	},
});

const navLink = tv({
	base: "rounded-md px-1 py-1 transition-colors hover:text-foreground",
	variants: {
		active: {
			true: "font-semibold text-foreground",
		},
	},
});

type NavVariants = VariantProps<typeof nav>;

interface NavProps extends NavVariants {
	links: NavItem[];
	ariaLabel?: string;
	className?: string;
}

export function Nav({ links, ariaLabel, variant, className }: NavProps) {
	return (
		<nav aria-label={ariaLabel} className={nav({ variant, class: className })}>
			{links.map((link) => (
				<NavLink
					key={link.to}
					to={link.to}
					end={link.end}
					className={({ isActive }) => navLink({ active: isActive })}
				>
					{link.label}
				</NavLink>
			))}
		</nav>
	);
}
