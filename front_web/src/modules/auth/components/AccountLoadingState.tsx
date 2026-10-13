export function AccountLoadingState() {
	return (
		<div className="grid gap-6">
			<div className="rounded-lg bg-secondary p-6">
				<div className="h-4 w-28 rounded bg-border" />
				<div className="mt-4 h-8 w-52 rounded bg-border" />
				<div className="mt-3 h-5 w-64 max-w-full rounded bg-border" />
			</div>
			<div className="rounded-lg bg-card p-6 shadow-sm">
				<div className="h-6 w-40 rounded bg-border" />
				<div className="mt-6 space-y-5">
					<div className="h-10 rounded bg-secondary" />
				</div>
			</div>
		</div>
	);
}
