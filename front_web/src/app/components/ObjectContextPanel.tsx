import { X } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useObject } from "@/modules/objects/hooks/useObject";
import { objectLink } from "@/modules/spaces/routes";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { useTranslation } from "@/shared/i18n";

function detailText(value: unknown) {
	if (Array.isArray(value)) {
		return value.join(", ");
	}

	if (value === null || value === undefined) {
		return "";
	}

	return String(value);
}

/**
 * Anytype's right-hand context column: the focused object's own values plus the
 * objects that link to it. It closes by dropping the focus from the URL, so the
 * middle column takes the width back.
 */
export function ObjectContextPanel({
	objectId,
	onClose,
}: {
	objectId: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const { object, backlinks, loading, error, refetch } = useObject(objectId);
	const entries = Object.entries(object?.details ?? {});

	return (
		<aside
			aria-label={t("shell.contextPanel")}
			className="flex w-[336px] shrink-0 flex-col gap-4 overflow-y-auto border-border border-l px-4 py-4"
		>
			<div className="flex items-start justify-between gap-2">
				<h2 className="break-words font-bold text-lg">{object?.name ?? ""}</h2>
				<div className="flex shrink-0 items-center gap-1">
					{object ? (
						<Link
							to={objectLink(object.id, object.spaceId)}
							className="text-muted-foreground text-sm transition-colors hover:text-foreground"
						>
							{t("shell.open")}
						</Link>
					) : null}
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={onClose}
						aria-label={t("shell.closePanel")}
					>
						<X aria-hidden="true" />
					</Button>
				</div>
			</div>

			{loading ? <LoadingSpinner /> : null}

			{error ? (
				<ErrorMessage message={error.message} onRetry={refetch} />
			) : null}

			{entries.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{t("shell.noProperties")}
				</p>
			) : (
				<dl className="flex flex-col gap-2">
					{entries.map(([key, value]) => (
						<div
							key={key}
							className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2 text-sm"
						>
							<dt className="truncate text-muted-foreground">{key}</dt>
							<dd className="break-words">{detailText(value)}</dd>
						</div>
					))}
				</dl>
			)}

			<div>
				<h3 className="font-semibold text-muted-foreground text-sm">
					{t("shell.backlinks")}
				</h3>
				{backlinks.length === 0 ? (
					<p className="mt-2 text-muted-foreground text-sm">
						{t("shell.noBacklinks")}
					</p>
				) : (
					<ul className="mt-2 flex flex-col gap-1 text-sm">
						{backlinks.map((backlink) => (
							<li key={backlink.id} className="truncate">
								{backlink.name}
							</li>
						))}
					</ul>
				)}
			</div>
		</aside>
	);
}
