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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { useTranslation } from "@/shared/i18n";
import { useBlockEditor } from "../hooks/useBlockEditor";
import type { DocumentBlock } from "../types";

function BlockRow({
	block,
	onCommitText,
}: {
	block: DocumentBlock;
	onCommitText: (blockId: string, text: string) => void;
}) {
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

/**
 * One object's document: its blocks in order, draggable and editable in place. It is
 * the body of a page object, so it carries no heading of its own.
 */
export function BlockDocument({ objectId }: { objectId: string }) {
	const { t } = useTranslation();
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const { loading, error, blocks, move, changeText, refetch } =
		useBlockEditor(objectId);

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event;

		if (over && active.id !== over.id) {
			move(String(active.id), String(over.id));
		}
	}

	if (loading) {
		return <LoadingSpinner />;
	}

	if (error) {
		return <ErrorMessage message={error.message} onRetry={refetch} />;
	}

	if (blocks.length === 0) {
		return (
			<EmptyState title={t("blocks.devTitle")} message={t("blocks.empty")} />
		);
	}

	return (
		<DndContext sensors={sensors} onDragEnd={handleDragEnd}>
			<SortableContext
				items={blocks.map((block) => block.id)}
				strategy={verticalListSortingStrategy}
			>
				<ul className="divide-y divide-border rounded-xl border border-border bg-card">
					{blocks.map((block) => (
						<BlockRow key={block.id} block={block} onCommitText={changeText} />
					))}
				</ul>
			</SortableContext>
		</DndContext>
	);
}
