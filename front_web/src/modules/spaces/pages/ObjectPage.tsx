import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { BlockDocument } from "@/modules/blocks/components/BlockDocument";
import { useObject } from "@/modules/objects/hooks/useObject";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { useTranslation } from "@/shared/i18n";
import { PropertyValue } from "../components/PropertyValue";
import { useObjectActions } from "../hooks/useObjectActions";
import { useSpaceRegistry } from "../hooks/useSpaceRegistry";
import { objectLink } from "../routes/routePaths";
import {
	cellText,
	columnsFor,
	pickCover,
	type ViewColumn,
} from "../views/viewModel";

function asRelationValue(
	format: ViewColumn["format"] | undefined,
	text: string,
) {
	if (format === "number") {
		return Number(text);
	}

	return text;
}

/**
 * Anytype's object page: one object read whole - its banner, its own values and the
 * objects that link to it - in the shell's middle column. Its address carries the
 * space so the rail keeps marking which space is open.
 */
export default function ObjectPage() {
	const { t } = useTranslation();
	const { objectId = "" } = useParams();
	const [searchParams] = useSearchParams();
	const { object, backlinks, loading, error, refetch } = useObject(objectId);
	const spaceId = searchParams.get("spaceId") ?? object?.spaceId ?? "";
	const { types, relationsByKey } = useSpaceRegistry(spaceId || undefined);
	const { updateObject, setDetail } = useObjectActions(spaceId || undefined);
	const type = types.find((row) => row.id === object?.typeId);
	const columns = columnsFor(type, relationsByKey);

	async function save(action: () => Promise<unknown>) {
		try {
			await action();
			toast.success(t("spaces.detailSaved"));
		} catch (cause) {
			toast.error((cause as Error).message);
		}
	}

	if (loading) {
		return (
			<div className="mx-auto max-w-4xl px-6 py-16">
				<LoadingSpinner />
			</div>
		);
	}

	if (error) {
		return (
			<div className="mx-auto max-w-4xl px-6 py-16">
				<ErrorMessage message={error.message} onRetry={refetch} />
			</div>
		);
	}

	if (!object) {
		return (
			<div className="mx-auto max-w-4xl px-6 py-16">
				<EmptyState
					title={t("objects.devTitle")}
					message={t("shell.noObject")}
				/>
			</div>
		);
	}

	const cover = pickCover(object, columns);
	const entries = Object.entries(object.details ?? {});

	return (
		<article className="mx-auto max-w-4xl px-6 py-12">
			{cover ? (
				<img
					src={cover}
					alt={object.name}
					className="mb-6 h-56 w-full rounded-xl object-cover"
				/>
			) : null}

			<div className="flex items-center gap-3">
				{object.iconEmoji ? (
					<span className="text-3xl" aria-hidden="true">
						{object.iconEmoji}
					</span>
				) : null}
				<PropertyValue
					value={object.name}
					label={t("spaces.name")}
					className="h-auto font-bold text-4xl"
					onCommit={(text) =>
						save(() => updateObject(object.id, { name: text }))
					}
				/>
			</div>

			{type ? (
				<Badge className="mt-3" variant="secondary">
					{type.name}
				</Badge>
			) : null}

			<section className="mt-8">
				<h2 className="font-semibold text-muted-foreground text-sm">
					{t("shell.properties")}
				</h2>

				{entries.length === 0 ? (
					<p className="mt-3 text-muted-foreground text-sm">
						{t("shell.noProperties")}
					</p>
				) : (
					<dl className="mt-3 flex flex-col gap-2">
						{entries.map(([key, value]) => {
							const column = columns.find((c) => c.key === key);

							return (
								<div
									key={key}
									className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 border-border border-b pb-2 text-base"
								>
									<dt className="truncate text-muted-foreground">
										{column?.label ?? key}
									</dt>
									<dd className="break-words">
										{column ? (
											<PropertyValue
												value={cellText(object, column)}
												label={column.label}
												onCommit={(text) =>
													save(() =>
														setDetail(
															object.id,
															key,
															asRelationValue(column.format, text),
														),
													)
												}
											/>
										) : Array.isArray(value) ? (
											value.join(", ")
										) : (
											String(value ?? "")
										)}
									</dd>
								</div>
							);
						})}
					</dl>
				)}
			</section>

			<section className="mt-10">
				<h2 className="font-semibold text-muted-foreground text-sm">
					{t("shell.backlinks")}
				</h2>

				{backlinks.length === 0 ? (
					<p className="mt-3 text-muted-foreground text-sm">
						{t("shell.noBacklinks")}
					</p>
				) : (
					<ul className="mt-3 flex flex-col gap-1">
						{backlinks.map((backlink) => (
							<li key={backlink.id}>
								<Link
									to={objectLink(backlink.id, backlink.spaceId)}
									className="rounded-md px-2 py-1 text-base transition-colors hover:bg-accent"
								>
									{backlink.name}
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>

			{object.resolvedLayout === "basic" ? (
				// Anytype's body carries no heading of its own; the document simply
				// continues below the properties.
				<div className="mt-10">
					<BlockDocument objectId={object.id} />
				</div>
			) : null}
		</article>
	);
}
