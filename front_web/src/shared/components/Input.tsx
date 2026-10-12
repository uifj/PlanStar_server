import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ type = "text", ...props }: InputProps) {
	return (
		<input
			type={type}
			{...props}
			className="rounded-lg border border-line bg-surface px-4 py-3 font-medium text-base text-ink shadow-sm outline-none transition-colors placeholder:text-soft focus:border-clay"
		/>
	);
}
