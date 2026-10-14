import { Command } from "cmdk";
import { useEffect } from "react";
import type { ObjectDetail } from "@/modules/objects/types";
import { useTranslation } from "@/shared/i18n";

/**
 * Keyboard access to everything already loaded in the space: jump to an object or
 * run a saved view. It searches the rows the browser already has, so it stays
 * honest about what the current query can actually reach.
 */
export function ObjectPalette({
	open,
	onOpenChange,
	objects,
	views,
	pickObject,
	pickView,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	objects: ObjectDetail[];
	views: ObjectDetail[];
	pickObject: (object: ObjectDetail) => void;
	pickView: (viewId: string) => void;
}) {
	const { t } = useTranslation();

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				onOpenChange(!open);
			}

			if (event.key === "Escape" && open) {
				onOpenChange(false);
			}
		}

		window.addEventListener("keydown", onKeyDown);

		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onOpenChange, open]);

	return (
		<Command.Dialog
			open={open}
			onOpenChange={onOpenChange}
			label={t("spaces.paletteLabel")}
			title={t("spaces.paletteTitle")}
			className="mt-[10vh] w-full max-w-lg gap-0 overflow-hidden rounded-xl border border-border bg-card p-0 shadow-lg"
		>
			<Command.Input
				autoFocus
				placeholder={t("spaces.palettePlaceholder")}
				className="w-full border-border border-b bg-transparent px-4 py-3 text-sm outline-none"
			/>
			<Command.List className="max-h-72 overflow-auto p-2">
				<Command.Empty>{t("spaces.paletteEmpty")}</Command.Empty>

				{views.length ? (
					<Command.Group heading={t("spaces.savedViews")}>
						{views.map((view) => (
							<Command.Item
								key={view.id}
								value={`${view.name} ${view.id}`}
								onSelect={() => pickView(view.id)}
							>
								{view.name}
							</Command.Item>
						))}
					</Command.Group>
				) : null}

				<Command.Group heading={t("spaces.paletteObjects")}>
					{objects.map((object) => (
						<Command.Item
							key={object.id}
							value={`${object.name} ${object.id}`}
							onSelect={() => pickObject(object)}
						>
							{object.iconEmoji ? `${object.iconEmoji} ` : ""}
							{object.name}
						</Command.Item>
					))}
				</Command.Group>
			</Command.List>
		</Command.Dialog>
	);
}
