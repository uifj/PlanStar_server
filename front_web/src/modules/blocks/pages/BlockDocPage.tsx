import {
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import { useTranslation } from "@/shared/i18n";
import { useBlockEditor } from "../hooks/useBlockEditor";
import type { DocumentBlock } from "../types";

interface BlockRowProps {
	block: DocumentBlock;
	onCommitText: (blockId: string, text: string) => void;
}

function BlockRow({ block, onCommitText }: BlockRowProps) {
	const { t } = useTranslation();
	const { attributes, listeners, setNodeRef, transform, transition } =
		useSortable({ id: block.id });
	const [text, setText] = useState(block.text);

	useEffect(() => setText(block.text), [block.text]);

	return (
		<li
			ref={setNodeRef}
			className="flex items-center gap-3 px-4 py-2"
			style={{ transform: CSS.Transform.toString(transform), transition }}
		>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="shrink-0 cursor-grab font-mono text-muted-foreground text-xs"
				aria-label={t("blocks.dragHandle")}
				{...attributes}
				{...listeners}
			>
				::
			</Button>
			<span className="w-24 shrink-0 font-medium text-muted-foreground text-xs uppercase">
				{block.style}
			</span>
			<Input
				className="grow"
				value={text}
				aria-label={t("blocks.textLabel")}
				onChange={(event) => setText(event.target.value)}
				onBlur={() => onCommitText(block.id, text)}
			/>
			{block.linkTargetId ? (
				<span className="shrink-0 text-muted-foreground text-xs">
					{t("blocks.linked")}
				</span>
			) : null}
		</li>
	);
}

export default function BlockDocPage() {
	const { t } = useTranslation();
	const [searchParams] = useSearchParams();
	const objectId = searchParams.get("objectId");
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const { loading, error, blocks, move, changeText, refetch } = useBlockEditor(
		objectId ?? "",
	);

	if (!objectId) {
		return (
			<div className="mx-auto max-w-4xl px-6 py-16">
				<EmptyState
					title={t("blocks.devTitle")}
					message={t("blocks.needsObject")}
				/>
			</div>
		);
	}

	if (loading) {
		return <LoadingSpinner />;
	}

	if (error) {
		return <ErrorMessage message={error.message} onRetry={refetch} />;
	}

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event;

		if (over && active.id !== over.id) {
			move(String(active.id), String(over.id));
		}
	}

	return (
		<section className="mx-auto max-w-4xl px-6 py-16">
			<PageHeader
				eyebrow={t("blocks.devEyebrow")}
				title={t("blocks.devTitle")}
				aside={
					<span className="font-medium text-muted-foreground text-sm">
						{t("blocks.count", { count: blocks.length })}
					</span>
				}
			/>

			<p className="mt-4 font-medium text-muted-foreground text-sm">
				{t("blocks.devDescription")}
			</p>

			{blocks.length === 0 ? (
				<div className="mt-10">
					<EmptyState
						title={t("blocks.devTitle")}
						message={t("blocks.empty")}
					/>
				</div>
			) : (
				<DndContext sensors={sensors} onDragEnd={handleDragEnd}>
					<SortableContext
						items={blocks.map((block) => block.id)}
						strategy={verticalListSortingStrategy}
					>
						<ul className="mt-10 divide-y divide-border rounded-xl border border-border bg-card">
							{blocks.map((block) => (
								<BlockRow
									key={block.id}
									block={block}
									onCommitText={changeText}
								/>
							))}
						</ul>
					</SortableContext>
				</DndContext>
			)}
		</section>
	);
}
