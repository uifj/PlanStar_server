import { useState } from "react";
import { useNavigate } from "react-router";
import { Alert } from "@/shared/components/Alert";
import { useArchiveHostVan } from "../hooks/useArchiveHostVan";

interface HostVanArchiveActionProps {
	vanId: string;
	vanName: string;
}

export function HostVanArchiveAction({
	vanId,
	vanName,
}: HostVanArchiveActionProps) {
	const [confirming, setConfirming] = useState(false);
	const navigate = useNavigate();
	const { archiveVan, loading, error } = useArchiveHostVan();

	function handleStartArchive() {
		setConfirming(true);
	}

	function handleCancelArchive() {
		setConfirming(false);
	}

	function handleConfirmArchive() {
		archiveVan(vanId, {
			onSuccess: () => {
				navigate("..", { replace: true });
			},
		});
	}

	return (
		<section
			aria-labelledby="archive-van-title"
			className="mt-8 rounded-xl border border-line bg-panel p-5"
		>
			<div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
				<div>
					<h2 id="archive-van-title" className="font-black text-ink text-xl">
						Archive this van
					</h2>
					<p className="mt-2 font-medium text-muted text-sm leading-6">
						Archived vans leave public browsing and your active host inventory.
						Existing records stay available for history.
					</p>
				</div>

				{confirming ? (
					<div className="flex flex-col gap-2 sm:flex-row md:justify-end">
						<button
							type="button"
							onClick={handleCancelArchive}
							disabled={loading}
							className="w-full rounded-lg border border-line px-4 py-2 font-bold text-ink text-sm transition-colors hover:border-clay hover:text-clay active:scale-95 disabled:text-muted sm:w-fit"
						>
							Keep van
						</button>
						<button
							type="button"
							onClick={handleConfirmArchive}
							disabled={loading}
							className="w-full rounded-lg bg-status-cancelled px-4 py-2 font-bold text-sm text-surface transition-colors hover:bg-clay-dark active:scale-95 disabled:bg-line disabled:text-muted sm:w-fit"
						>
							{loading ? "Archiving..." : "Confirm archive"}
						</button>
					</div>
				) : (
					<button
						type="button"
						onClick={handleStartArchive}
						className="w-full rounded-lg border border-status-cancelled/30 px-4 py-2 font-bold text-sm text-status-cancelled transition-colors hover:bg-status-cancelled/10 active:scale-95 sm:w-fit"
					>
						Archive van
					</button>
				)}
			</div>

			{confirming ? (
				<p className="mt-4 font-semibold text-muted text-sm">
					Confirm archive for {vanName}.
				</p>
			) : null}

			{error ? (
				<div className="mt-4">
					<Alert variant="error">{error.message}</Alert>
				</div>
			) : null}
		</section>
	);
}
