import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * One value of one object, edited where it is shown. A field left as it was writes
 * nothing, and it re-reads itself when the object changes underneath it, which is what
 * both the table cell and the object page need. How a string becomes a relation value
 * stays with the caller, because only it knows the format.
 */
export function PropertyValue({
	value,
	label,
	onCommit,
	disabled,
	className,
}: {
	value: string;
	label: string;
	onCommit: (next: string) => void;
	disabled?: boolean;
	className?: string;
}) {
	const [draft, setDraft] = useState(value);

	useEffect(() => setDraft(value), [value]);

	return (
		<Input
			aria-label={label}
			className={cn("h-8", className)}
			value={draft}
			disabled={disabled}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={() => {
				if (draft === value) {
					return;
				}

				onCommit(draft);
			}}
		/>
	);
}
