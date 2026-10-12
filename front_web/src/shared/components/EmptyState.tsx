import type { ReactNode } from "react";

interface EmptyStateProps {
	title: string;
	message: string;
	action?: ReactNode;
}

export function EmptyState({ title, message, action }: EmptyStateProps) {
	return (
		<div className="rounded-xl bg-surface px-6 py-10 text-center shadow-sm">
			<h2 className="mb-3 font-black text-2xl text-ink">{title}</h2>
			<p className="mx-auto max-w-md font-medium text-muted leading-7">
				{message}
			</p>
			{action && <div className="mt-6">{action}</div>}
		</div>
	);
}
