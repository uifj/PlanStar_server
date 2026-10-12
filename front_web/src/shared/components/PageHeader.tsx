import type { ReactNode } from "react";
import { cn } from "tailwind-variants";

interface PageHeaderProps {
	eyebrow: string;
	title: string;
	aside?: ReactNode;
	className?: string;
	titleClassName?: string;
}

export function PageHeader({
	eyebrow,
	title,
	aside,
	className,
	titleClassName,
}: PageHeaderProps) {
	return (
		<div
			className={cn(
				"mb-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between",
				className,
			)}
		>
			<div className="max-w-3xl">
				<p className="mb-4 font-semibold text-clay text-sm uppercase tracking-widest">
					{eyebrow}
				</p>
				<h1
					className={cn(
						"text-balance font-black text-4xl text-ink leading-tight md:text-5xl",
						titleClassName,
					)}
				>
					{title}
				</h1>
			</div>
			{aside}
		</div>
	);
}
