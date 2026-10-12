export default function LoadingSpinner() {
	return (
		<div
			role="status"
			aria-live="polite"
			className="mx-auto flex min-h-96 max-w-7xl items-center justify-center px-6"
		>
			<div className="size-10 animate-spin rounded-full border-4 border-panel border-t-clay" />
			<span className="sr-only">Loading</span>
		</div>
	);
}
