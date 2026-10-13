import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert } from "@/shared/components/Alert";
import { useTranslation } from "@/shared/i18n";
import { useArchiveHostVan } from "../hooks/useArchiveHostVan";

interface HostVanArchiveActionProps {
	vanId: string;
	vanName: string;
}

export function HostVanArchiveAction({
	vanId,
	vanName,
}: HostVanArchiveActionProps) {
	const { t } = useTranslation();
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
			className="mt-8 rounded-xl border border-border bg-secondary p-5"
		>
			<div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
				<div>
					<h2
						id="archive-van-title"
						className="font-black text-foreground text-xl"
					>
						{t("host.archive.title")}
					</h2>
					<p className="mt-2 font-medium text-muted-foreground text-sm leading-6">
						{t("host.archive.description")}
					</p>
				</div>

				{confirming ? (
					<div className="flex flex-col gap-2 sm:flex-row md:justify-end">
						<Button
							type="button"
							variant="outline"
							onClick={handleCancelArchive}
							disabled={loading}
							className="w-full sm:w-fit"
						>
							{t("host.archive.keep")}
						</Button>
						<Button
							type="button"
							variant="destructive"
							onClick={handleConfirmArchive}
							disabled={loading}
							className="w-full sm:w-fit"
						>
							{loading
								? t("host.archive.archiving")
								: t("host.archive.confirm")}
						</Button>
					</div>
				) : (
					<Button
						type="button"
						variant="outline"
						onClick={handleStartArchive}
						className="w-full border-status-cancelled/30 text-status-cancelled hover:bg-status-cancelled/10 hover:text-status-cancelled sm:w-fit"
					>
						{t("host.archive.archiveVan")}
					</Button>
				)}
			</div>

			{confirming ? (
				<p className="mt-4 font-semibold text-muted-foreground text-sm">
					{t("host.archive.confirmFor", { vanName })}
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
