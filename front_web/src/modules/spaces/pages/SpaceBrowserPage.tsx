import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useObjects } from "@/modules/objects/hooks/useObjects";
import type { ObjectDetail } from "@/modules/objects/types";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import { useTranslation } from "@/shared/i18n";
import { ObjectPalette } from "../components/ObjectPalette";
import { PropertyValue } from "../components/PropertyValue";
import { QueryBuilder } from "../components/QueryBuilder";
import { useDataviewRecords } from "../hooks/useDataviewRecords";
import { useDataviews } from "../hooks/useDataviews";
import { useObjectActions } from "../hooks/useObjectActions";
import { useSpaceRegistry } from "../hooks/useSpaceRegistry";
import { useSpaces } from "../hooks/useSpaces";
// The concrete path, not the barrel: routes/index also imports this page.
import { objectLink } from "../routes/routePaths";
import {
	activeClauses,
	queryParams,
	readQuery,
	storedQuery,
	type ViewQuery,
} from "../views/queryModel";
import {
	cellText,
	columnsFor,
	coverColumn,
	groupByMonth,
	groupByRelation,
	layoutNamed,
	objectsWithoutDate,
	pickCover,
	VIEW_LAYOUTS,
	type ViewColumn,
	type ViewLayout,
	viewLayout,
} from "../views/viewModel";

const PAGE_LIMIT = 50;

function rowClass(objectId: string | undefined, focusId: string) {
	return [
		"border-border border-t",
		objectId && objectId === focusId ? "bg-accent" : "",
	].join(" ");
}

export default function SpaceBrowserPage() {
	const { t } = useTranslation();
	const [searchParams, setSearchParams] = useSearchParams();
	const spaceId = searchParams.get("spaceId") ?? "";
	const typeId = searchParams.get("typeId") ?? "";
	const viewId = searchParams.get("viewId") ?? "";
	const viewKind = layoutNamed(searchParams.get("view"));
	const groupKey = searchParams.get("group") ?? "";
	const coverKey = searchParams.get("cover") ?? "";
	const focusId = searchParams.get("focus") ?? "";
	const [paletteOpen, setPaletteOpen] = useState(false);

	const { spaces } = useSpaces();
	const { types, relationsByKey } = useSpaceRegistry(spaceId || undefined);
	const activeType = types.find((type) => type.id === typeId);
	const columns = useMemo(
		() => columnsFor(activeType, relationsByKey),
		[activeType, relationsByKey],
	);

	const query = readQuery(searchParams, columns);

	const objects = useObjects({
		spaceId: spaceId || undefined,
		query: {
			typeId: typeId || undefined,
			limit: PAGE_LIMIT,
			sort: query.sorts[0]?.key ?? "updatedAt",
			order: query.sorts[0]?.order ?? "desc",
			// The kernel lists archived objects too; the browser shows what is live.
			filters: [
				{ key: "isArchived", operator: "equal", value: false },
				...activeClauses(query.filters),
			],
		},
	});
	const { views, saveView, renameView, archiveView, setLayout } = useDataviews(
		spaceId || undefined,
	);
	const records = useDataviewRecords(
		spaceId || undefined,
		viewId || undefined,
		{ limit: PAGE_LIMIT },
	);
	const { createObject, setDetail, archiveObject } = useObjectActions(spaceId);

	const rows = viewId ? records.records : objects.objects;
	const loading = viewId ? records.loading : objects.loading;
	const error = viewId ? records.error : objects.error;
	const refetch = viewId ? records.refetch : objects.refetch;

	// Written as an update, not a snapshot: the layout menu can change two params in
	// the same tick, and a captured searchParams would drop the first one.
	function patch(params: Record<string, string>) {
		setSearchParams((current) => {
			const next = new URLSearchParams(current);

			for (const [key, value] of Object.entries(params)) {
				if (value) {
					next.set(key, value);
				} else {
					next.delete(key);
				}
			}

			return next;
		});
	}

	async function run(action: () => Promise<unknown>, message: string) {
		try {
			await action();
			toast.success(message);
		} catch (cause) {
			toast.error((cause as Error).message);
		}
	}

	const activeView = views.find((view) => view.id === viewId);
	// The view most recently applied, so an edited query can be written back to it on
	// one deliberate click rather than on every clause change.
	const [lastAppliedId, setLastAppliedId] = useState("");

	// Applying a saved view puts its stored layout and its stored query on the page, so
	// the view - not the address bar - decides what the visitor sees (ADR-0012).
	function applyView(id: string) {
		const chosen = views.find((view) => view.id === id);
		const stored = viewLayout(chosen);

		setLastAppliedId(id);

		patch({
			viewId: id,
			view: stored.layout,
			group: stored.groupRelationKey,
			cover: stored.coverRelationKey,
			...queryParams(storedQuery(chosen)),
		});
	}

	// Editing a clause leaves view mode: the list on screen then answers the query in
	// the address bar. Writing back to the view is the separate click below, because a
	// PATCH replaces the view's whole statement and one response per keystroke would
	// let a late reply overwrite a newer one.
	function applyQuery(next: ViewQuery) {
		patch({ ...queryParams(next), viewId: "" });
	}

	function updateAppliedView() {
		const view = views.find((row) => row.id === lastAppliedId);

		if (!view) {
			return;
		}

		void run(async () => {
			const moved = await setLayout(view.id, {
				viewType: viewKind,
				groupRelationKey: groupKey || null,
				coverRelationKey: coverKey || null,
				filters: activeClauses(query.filters),
				sorts: query.sorts,
			});
			const stored = viewLayout(moved);

			setLastAppliedId("");

			patch({
				viewId: view.id,
				view: stored.layout,
				group: stored.groupRelationKey,
				cover: stored.coverRelationKey,
				...queryParams(storedQuery(moved)),
			});
		}, t("spaces.viewUpdated"));
	}

	function moveLayout(next: ViewLayout) {
		patch({ view: next });

		if (!activeView) {
			return;
		}

		// The view decides which keys the layout can keep, so the address bar is
		// rewritten from what it came back with rather than from what was asked.
		void run(async () => {
			const moved = viewLayout(
				await setLayout(activeView.id, { viewType: next }),
			);

			patch({
				view: moved.layout,
				group: moved.groupRelationKey,
				cover: moved.coverRelationKey,
			});
		}, t("spaces.layoutSaved"));
	}

	function setGroup(key: string) {
		patch({ group: key });

		if (activeView) {
			void run(
				() => setLayout(activeView.id, { groupRelationKey: key || null }),
				t("spaces.layoutSaved"),
			);
		}
	}

	function setCover(key: string) {
		patch({ cover: key });

		if (activeView) {
			void run(
				() => setLayout(activeView.id, { coverRelationKey: key || null }),
				t("spaces.layoutSaved"),
			);
		}
	}

	if (!spaceId) {
		return (
			<div className="mx-auto max-w-6xl px-6 py-16">
				<PageHeader eyebrow={t("spaces.eyebrow")} title={t("spaces.title")} />
				<div className="mt-10">
					<EmptyState
						title={t("spaces.title")}
						message={t("spaces.needsSpace")}
					/>
				</div>
				<SpaceList
					spaces={spaces}
					onPick={(id) => patch({ spaceId: id })}
					// A space created here is the one the visitor wants to see.
					onCreated={(id) => patch({ spaceId: id })}
				/>
			</div>
		);
	}

	return (
		<div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-12">
			<section className="min-w-0 flex-1">
				<PageHeader
					eyebrow={spaces.find((s) => s.id === spaceId)?.name ?? spaceId}
					title={activeType?.name ?? t("spaces.allTypes")}
					aside={
						<span className="font-medium text-muted-foreground text-sm">
							{t("spaces.objectCount", { count: rows.length })}
						</span>
					}
				/>

				<div className="mt-6 flex flex-wrap items-center gap-2">
					<div className="flex items-center gap-1 rounded-md border border-border p-1">
						{VIEW_LAYOUTS.map((kind) => (
							<Button
								key={kind}
								type="button"
								size="sm"
								variant={viewKind === kind ? "default" : "ghost"}
								className="h-8 font-bold text-xl"
								onClick={() => moveLayout(kind)}
							>
								{t(`spaces.view.${kind}`)}
							</Button>
						))}
					</div>

					{viewKind === "board" ? (
						<select
							className="h-8 rounded-md border border-border bg-transparent px-2 text-base"
							value={groupKey}
							onChange={(event) => setGroup(event.target.value)}
						>
							<option value="">{t("spaces.groupBy")}</option>
							{columns
								.filter(
									(c) => c.format === "select" || c.format === "multiSelect",
								)
								.map((c) => (
									<option key={c.key} value={c.key}>
										{c.label}
									</option>
								))}
						</select>
					) : null}

					{viewKind === "calendar" ? (
						<select
							className="h-8 rounded-md border border-border bg-transparent px-2 text-base"
							value={groupKey}
							onChange={(event) => setGroup(event.target.value)}
						>
							<option value="">{t("spaces.dateField")}</option>
							{columns
								.filter((c) => c.format === "date")
								.map((c) => (
									<option key={c.key} value={c.key}>
										{c.label}
									</option>
								))}
						</select>
					) : null}

					{viewKind === "gallery" || viewKind === "board" ? (
						<select
							className="h-8 rounded-md border border-border bg-transparent px-2 text-base"
							value={coverKey}
							onChange={(event) => setCover(event.target.value)}
						>
							<option value="">{t("spaces.coverField")}</option>
							{columns
								.filter((c) => c.key !== "name")
								.map((c) => (
									<option key={c.key} value={c.key}>
										{c.label}
									</option>
								))}
						</select>
					) : null}

					<NewObject
						typeId={typeId}
						onCreate={async (name) => {
							await run(
								() => createObject({ typeId: typeId || undefined, name }),
								t("spaces.created"),
							);
						}}
					/>

					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() => setPaletteOpen(true)}
					>
						{t("spaces.paletteTitle")} ⌘K
					</Button>
				</div>

				<QueryBuilder columns={columns} query={query} onChange={applyQuery} />

				<ViewBar
					views={views}
					activeViewId={viewId}
					onApply={applyView}
					onClear={() => {
						setLastAppliedId("");
						patch({ viewId: "" });
					}}
					pendingView={
						viewId || !lastAppliedId
							? ""
							: (views.find((view) => view.id === lastAppliedId)?.name ?? "")
					}
					onUpdate={updateAppliedView}
					onSave={async (name) => {
						if (!typeId) {
							toast.error(t("spaces.pickTypeFirst"));

							return;
						}

						await run(
							() =>
								saveView({
									name,
									sourceTypeId: typeId,
									viewType: viewKind,
									groupRelationKey: groupKey || undefined,
									coverRelationKey: coverKey || undefined,
									filters: activeClauses(query.filters),
									sorts: query.sorts.length
										? query.sorts
										: [{ key: "updatedAt", order: "desc" }],
								}),
							t("spaces.viewSaved"),
						);
					}}
					onRename={async (id, name) =>
						run(() => renameView(id, name), t("spaces.viewRenamed"))
					}
					onArchive={async (id) =>
						run(async () => {
							await archiveView(id);

							if (id === viewId) {
								patch({ viewId: "" });
							}
						}, t("spaces.viewArchived"))
					}
				/>

				{loading ? <LoadingSpinner /> : null}

				{error ? (
					<ErrorMessage message={error.message} onRetry={refetch} />
				) : null}

				{!loading && !error && rows.length === 0 ? (
					<div className="mt-10">
						<EmptyState title={t("spaces.title")} message={t("spaces.empty")} />
					</div>
				) : null}

				{!loading && rows.length > 0 ? (
					<div className="mt-8">
						{viewKind === "grid" ? (
							<ObjectTable
								rows={rows}
								columns={columns}
								focusId={focusId}
								onEdit={async (object, column, value) =>
									run(
										() => setDetail(object.id, column.key, value),
										t("spaces.detailSaved"),
									)
								}
								onArchive={(object) =>
									run(() => archiveObject(object.id), t("spaces.archived"))
								}
								onFocus={(id) => patch({ focus: id })}
							/>
						) : null}

						{viewKind === "gallery" ? (
							<Gallery rows={rows} columns={columns} coverKey={coverKey} />
						) : null}

						{viewKind === "board" ? (
							<Board
								rows={rows}
								groupKey={groupKey}
								columns={columns}
								groupLabel={columns.find((c) => c.key === groupKey)?.label}
							/>
						) : null}

						{viewKind === "calendar" ? (
							<Calendar
								rows={rows}
								dateKey={groupKey}
								columns={columns}
								undatedLabel={t("spaces.noDate")}
							/>
						) : null}
					</div>
				) : null}

				<ObjectPalette
					open={paletteOpen}
					onOpenChange={setPaletteOpen}
					objects={rows}
					views={views}
					pickView={(id) => {
						patch({ viewId: id });
						setPaletteOpen(false);
					}}
					pickObject={(object) => {
						patch({
							typeId: object.typeId ?? "",
							viewId: "",
							focus: object.id,
						});
						setPaletteOpen(false);
					}}
				/>
			</section>
		</div>
	);
}

function SpaceList({
	spaces,
	activeId,
	onPick,
	onCreated,
}: {
	spaces: { id: string; name: string }[];
	activeId?: string;
	onPick: (id: string) => void;
	onCreated?: (id: string) => void;
}) {
	const { t } = useTranslation();
	const { createSpace } = useSpaces();
	const [name, setName] = useState("");

	return (
		<div className="rounded-xl border border-border bg-card">
			<h2 className="border-border border-b px-4 py-3 font-semibold text-sm">
				{t("spaces.rail")}
			</h2>
			<ul className="divide-y divide-border">
				{spaces.map((space) => (
					<li key={space.id}>
						<button
							type="button"
							onClick={() => onPick(space.id)}
							className={`w-full px-4 py-3 text-left text-sm hover:bg-accent ${
								space.id === activeId ? "font-semibold" : ""
							}`}
						>
							{space.name}
						</button>
					</li>
				))}
			</ul>
			<form
				className="flex gap-2 border-border border-t p-3"
				onSubmit={async (event) => {
					event.preventDefault();

					if (!name.trim()) {
						return;
					}

					try {
						const created = await createSpace(name.trim());

						onCreated?.(created.id);
						setName("");
					} catch (cause) {
						toast.error((cause as Error).message);
					}
				}}
			>
				<Input
					value={name}
					placeholder={t("spaces.newSpace")}
					onChange={(event) => setName(event.target.value)}
				/>
				<Button type="submit" size="sm">
					{t("spaces.add")}
				</Button>
			</form>
		</div>
	);
}

function ViewBar({
	views,
	activeViewId,
	pendingView,
	onApply,
	onClear,
	onSave,
	onUpdate,
	onRename,
	onArchive,
}: {
	views: ObjectDetail[];
	activeViewId: string;
	pendingView: string;
	onApply: (id: string) => void;
	onClear: () => void;
	onSave: (name: string) => void;
	onUpdate: () => void;
	onRename: (id: string, name: string) => void;
	onArchive: (id: string) => void;
}) {
	const { t } = useTranslation();
	const [draft, setDraft] = useState("");
	const [renamingId, setRenamingId] = useState("");
	const [renameDraft, setRenameDraft] = useState("");

	function commitRename(viewId: string) {
		setRenamingId("");

		if (renameDraft.trim()) {
			onRename(viewId, renameDraft.trim());
		}
	}

	return (
		<div className="mt-4 flex flex-wrap items-center gap-2">
			<span className="text-muted-foreground text-sm">
				{t("spaces.savedViews")}
			</span>
			{views.length === 0 ? (
				<span className="text-muted-foreground text-sm">
					{t("spaces.noViews")}
				</span>
			) : null}
			{views.map((view) => (
				<span key={view.id} className="flex items-center gap-1">
					{renamingId === view.id ? (
						<Input
							className="h-8 w-40"
							autoFocus
							value={renameDraft}
							onChange={(event) => setRenameDraft(event.target.value)}
							onBlur={() => commitRename(view.id)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									commitRename(view.id);
								}
							}}
						/>
					) : (
						<Button
							type="button"
							size="sm"
							variant={view.id === activeViewId ? "default" : "outline"}
							onClick={() => onApply(view.id)}
						>
							{view.name}
						</Button>
					)}
					<Button
						type="button"
						size="sm"
						variant="ghost"
						onClick={() => {
							setRenamingId(view.id);
							setRenameDraft(view.name);
						}}
					>
						{t("spaces.rename")}
					</Button>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						onClick={() => onArchive(view.id)}
					>
						{t("spaces.archive")}
					</Button>
				</span>
			))}
			{activeViewId ? (
				<Button type="button" size="sm" variant="ghost" onClick={onClear}>
					{t("spaces.clearView")}
				</Button>
			) : null}
			{pendingView ? (
				<Button type="button" size="sm" variant="outline" onClick={onUpdate}>
					{t("spaces.updateView", { name: pendingView })}
				</Button>
			) : null}
			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();

					if (!draft.trim()) {
						return;
					}

					onSave(draft.trim());
					setDraft("");
				}}
			>
				<Input
					className="h-8 w-44"
					value={draft}
					placeholder={t("spaces.viewNamePrompt")}
					onChange={(event) => setDraft(event.target.value)}
				/>
				<Button type="submit" size="sm" variant="outline">
					{t("spaces.saveCurrent")}
				</Button>
			</form>
		</div>
	);
}

function NewObject({
	typeId,
	onCreate,
}: {
	typeId: string;
	onCreate: (name: string) => void;
}) {
	const { t } = useTranslation();
	const [name, setName] = useState("");

	return (
		<form
			className="flex gap-2"
			onSubmit={(event) => {
				event.preventDefault();

				if (!name.trim()) {
					return;
				}

				onCreate(name.trim());
				setName("");
			}}
		>
			<Input
				value={name}
				placeholder={t("spaces.newObject")}
				onChange={(event) => setName(event.target.value)}
			/>
			<Button type="submit" size="sm" variant="outline" disabled={!typeId}>
				{t("spaces.add")}
			</Button>
		</form>
	);
}

function EditableCell({
	object,
	column,
	onEdit,
}: {
	object: ObjectDetail;
	column: ViewColumn;
	onEdit: (object: ObjectDetail, column: ViewColumn, value: unknown) => void;
}) {
	return (
		<PropertyValue
			value={cellText(object, column)}
			label={column.label}
			disabled={column.key === "name"}
			onCommit={(text) =>
				onEdit(object, column, column.format === "number" ? Number(text) : text)
			}
		/>
	);
}

function ObjectTable({
	rows,
	columns,
	focusId,
	onEdit,
	onArchive,
	onFocus,
}: {
	rows: ObjectDetail[];
	columns: ViewColumn[];
	focusId: string;
	onEdit: (object: ObjectDetail, column: ViewColumn, value: unknown) => void;
	onArchive: (object: ObjectDetail) => void;
	onFocus: (objectId: string) => void;
}) {
	const { t } = useTranslation();
	const scrollRef = useRef<HTMLDivElement>(null);
	const virtual = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 52,
		overscan: 8,
	});
	const windowed = rows.length > 30;
	const items = windowed ? virtual.getVirtualItems() : [];
	const focusedAt = rows.findIndex((object) => object.id === focusId);

	// A jump from the palette has to reach a row the list may not have rendered yet.
	useEffect(() => {
		if (windowed && focusedAt >= 0) {
			virtual.scrollToIndex(focusedAt, { align: "center" });
		}
	}, [focusedAt, virtual, windowed]);

	return (
		<div
			ref={scrollRef}
			className="max-h-[70vh] overflow-auto rounded-xl border border-border"
		>
			<table className="w-full text-base">
				<thead className="sticky top-0 bg-muted/40">
					<tr>
						{columns.map((column) => (
							<th
								key={column.key}
								className="px-4 py-2 text-left font-normal text-muted-foreground text-sm"
							>
								{column.key === "name" ? t("spaces.name") : column.label}
							</th>
						))}
						<th className="px-4 py-2" />
					</tr>
				</thead>
				<tbody>
					{windowed
						? items.map((item) => (
								<tr
									key={item.key}
									data-index={item.index}
									ref={virtual.measureElement}
									className={rowClass(rows[item.index]?.id, focusId)}
									onClick={() => {
										const row = rows[item.index];

										if (row) {
											onFocus(row.id);
										}
									}}
								>
									<Row
										object={rows[item.index]}
										columns={columns}
										onEdit={onEdit}
										onArchive={onArchive}
									/>
								</tr>
							))
						: rows.map((object) => (
								<tr
									key={object.id}
									className={rowClass(object.id, focusId)}
									onClick={() => onFocus(object.id)}
								>
									<Row
										object={object}
										columns={columns}
										onEdit={onEdit}
										onArchive={onArchive}
									/>
								</tr>
							))}
				</tbody>
			</table>
		</div>
	);
}

function Row({
	object,
	columns,
	onEdit,
	onArchive,
}: {
	object: ObjectDetail;
	columns: ViewColumn[];
	onEdit: (object: ObjectDetail, column: ViewColumn, value: unknown) => void;
	onArchive: (object: ObjectDetail) => void;
}) {
	const { t } = useTranslation();

	return (
		<>
			{columns.map((column) => (
				<td key={column.key} className="px-2 py-1 align-top">
					<EditableCell object={object} column={column} onEdit={onEdit} />
				</td>
			))}
			<td className="whitespace-nowrap px-2 py-1 text-right">
				<Link
					to={objectLink(object.id, object.spaceId)}
					className="mr-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
				>
					{t("shell.open")}
				</Link>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={() => onArchive(object)}
				>
					{t("spaces.archive")}
				</Button>
			</td>
		</>
	);
}

function Gallery({
	rows,
	columns,
	coverKey,
}: {
	rows: ObjectDetail[];
	columns: ViewColumn[];
	coverKey: string;
}) {
	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{rows.map((object) => {
				const cover = pickCover(object, columns, coverKey);
				const chosen = columns.find((c) => c.key === coverKey);
				const shown = chosen ?? coverColumn(object, columns);
				const meta = columns
					.filter((c) => c.key !== "name" && c.key !== shown?.key)
					.slice(0, 3)
					.map((c) => `${c.label}: ${cellText(object, c)}`);

				return (
					<Card key={object.id} className="overflow-hidden p-0">
						{cover ? (
							<img
								src={cover}
								alt={object.name}
								className="h-36 w-full object-cover"
							/>
						) : (
							<div className="flex h-36 w-full items-center justify-center bg-muted text-3xl">
								{object.iconEmoji ?? "◇"}
							</div>
						)}
						<div className="space-y-1 p-4">
							<p className="font-semibold">{object.name}</p>
							{meta.map((line) => (
								<p key={line} className="text-muted-foreground text-sm">
									{line}
								</p>
							))}
						</div>
					</Card>
				);
			})}
		</div>
	);
}

function Board({
	rows,
	groupKey,
	columns,
	groupLabel,
}: {
	rows: ObjectDetail[];
	groupKey: string;
	columns: ViewColumn[];
	groupLabel?: string;
}) {
	const { t } = useTranslation();
	const groups = groupKey ? groupByRelation(rows, groupKey) : [];

	if (!groupKey) {
		return (
			<p className="text-muted-foreground text-sm">{t("spaces.pickGroup")}</p>
		);
	}

	return (
		<div className="flex gap-4 overflow-x-auto pb-2">
			{groups.map((group) => (
				<div key={group.key} className="w-72 shrink-0">
					<h3 className="mb-2 flex items-center justify-between font-medium text-base">
						{group.key === "untagged" ? t("spaces.untagged") : group.label}
						<Badge variant="secondary">{group.objects.length}</Badge>
					</h3>
					<ul className="space-y-2">
						{group.objects.map((object) => (
							<li
								key={object.id}
								className="rounded-lg border border-border bg-card p-3 text-base"
							>
								<p className="font-medium">{object.name}</p>
								<p className="text-muted-foreground text-sm">
									{columns
										.filter((c) => c.key !== "name")
										.slice(0, 2)
										.map((c) => cellText(object, c))
										.join(" · ")}
								</p>
							</li>
						))}
					</ul>
				</div>
			))}
			<span className="text-muted-foreground text-sm">{groupLabel}</span>
		</div>
	);
}

function Calendar({
	rows,
	dateKey,
	columns,
	undatedLabel,
}: {
	rows: ObjectDetail[];
	dateKey: string;
	columns: ViewColumn[];
	undatedLabel: string;
}) {
	const { t } = useTranslation();

	if (!dateKey) {
		return (
			<p className="text-muted-foreground text-sm">
				{t("spaces.pickDateField")}
			</p>
		);
	}

	const months = groupByMonth(rows, dateKey);
	const undated = objectsWithoutDate(rows, dateKey);

	return (
		<div className="space-y-8">
			{months.map((bucket) => (
				<section key={bucket.month}>
					<h3 className="mb-2 font-semibold text-sm capitalize">
						{bucket.month}
					</h3>
					<ul className="divide-y divide-border rounded-xl border border-border">
						{bucket.days.map((day) => (
							<li key={day.day} className="flex gap-4 px-4 py-3 text-sm">
								<span className="w-28 shrink-0 font-mono text-muted-foreground">
									{day.day.slice(8)}
								</span>
								<span className="min-w-0">
									{day.objects.map((object) => (
										<span key={object.id} className="mr-3">
											{object.name}
											<span className="text-muted-foreground text-sm">
												{" "}
												{columns
													.filter((c) => c.key !== "name")
													.slice(0, 1)
													.map((c) => cellText(object, c))
													.join(" ")}
											</span>
										</span>
									))}
								</span>
							</li>
						))}
					</ul>
				</section>
			))}
			{undated.length ? (
				<p className="text-muted-foreground text-sm">
					{undatedLabel}: {undated.map((o) => o.name).join(", ")}
				</p>
			) : null}
		</div>
	);
}
