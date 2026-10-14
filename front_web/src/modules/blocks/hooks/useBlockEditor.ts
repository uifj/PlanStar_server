import { arrayMove } from "@dnd-kit/sortable";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { blockQueryKeys } from "../queryKeys";
import { getBlocks, updateBlock } from "../services/blockService";
import type { DocumentBlock } from "../types";

/**
 * The server owns block indexes, so a drag is expressed as "land after this
 * sibling" and sent as one PATCH for the moved block (ADR-0013). The cached order
 * is rewritten immediately so the list does not jump back on drop.
 */
export function useBlockEditor(objectId: string) {
	const client = useQueryClient();
	const key = blockQueryKeys.document(objectId);
	const { isPending, error, data, refetch } = useQuery({
		queryKey: key,
		queryFn: () => getBlocks(objectId),
		enabled: Boolean(objectId),
	});

	function currentBlocks() {
		return client.getQueryData<DocumentBlock[]>(key) ?? [];
	}

	async function move(activeId: string, overId: string) {
		const blocks = currentBlocks();
		const from = blocks.findIndex((block) => block.id === activeId);
		const to = blocks.findIndex((block) => block.id === overId);

		if (from < 0 || to < 0 || from === to) {
			return;
		}

		const ordered = arrayMove(blocks, from, to);
		const position = ordered.findIndex((block) => block.id === activeId);
		const afterBlockId = ordered[position - 1]?.id ?? null;

		client.setQueryData(key, ordered);

		try {
			await updateBlock(activeId, { afterBlockId });
		} finally {
			await refetch();
		}
	}

	async function changeText(blockId: string, text: string) {
		const blocks = currentBlocks();
		const target = blocks.find((block) => block.id === blockId);

		if (!target || target.text === text) {
			return;
		}

		client.setQueryData(
			key,
			blocks.map((block) =>
				block.id === blockId ? { ...block, text } : block,
			),
		);

		try {
			await updateBlock(blockId, { text });
		} finally {
			await refetch();
		}
	}

	return {
		loading: isPending,
		error,
		blocks: data ?? [],
		move,
		changeText,
		refetch,
	};
}
