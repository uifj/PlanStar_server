import { FaTriangleExclamation } from "react-icons/fa6";
import { cn } from "tailwind-variants";

interface ErrorMessageProps {
	title?: string;
	message?: string;
	onRetry?: () => void;
	className?: string;
}

export default function ErrorMessage({
	title = "Something went wrong",
	message = "We couldn't load the requested content. Please try again.",
	onRetry,
	className,
}: ErrorMessageProps) {
	return (
		<div
			role="alert"
			aria-live="assertive"
			className={cn(
				"mx-auto flex min-h-96 max-w-7xl items-center justify-center px-6",
				className,
			)}
		>
			<div className="flex max-w-md flex-col items-center text-center">
				<FaTriangleExclamation
					aria-hidden="true"
					className="mb-6 text-5xl text-clay"
				/>

				<h2 className="mb-3 font-black text-3xl text-ink">{title}</h2>

				<p className="mb-8 font-medium text-base text-muted leading-7">
					{message}
				</p>

				{onRetry && (
					<button
						type="button"
						onClick={onRetry}
						className="rounded-lg bg-clay px-6 py-3 font-bold text-surface transition-colors hover:bg-clay-dark active:scale-95"
					>
						Try again
					</button>
				)}
			</div>
		</div>
	);
}
