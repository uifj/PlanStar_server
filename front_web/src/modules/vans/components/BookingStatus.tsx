import { cn } from "tailwind-variants";

interface BookingStatusProps {
	message: string;
	variant: "ready" | "error" | "success";
}

export function BookingStatus({ message, variant }: BookingStatusProps) {
	const statusClassName = cn(
		"rounded-lg px-4 py-3 font-semibold text-sm",
		variant === "success" && "bg-sage text-card",
		variant === "error" && "bg-primary/10 text-primary",
		variant === "ready" && "bg-forest/10 text-forest",
	);

	return (
		<div aria-live="polite">
			{message ? <p className={statusClassName}>{message}</p> : null}
		</div>
	);
}
