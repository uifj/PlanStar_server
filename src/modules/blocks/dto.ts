import type { Block } from "../../generated/prisma/client.js";

// The index is server-minted and deliberately not part of the payload: order is
// carried by position in the list, and clients position with afterBlockId.
export function toBlock(block: Block) {
	return {
		id: block.id,
		objectId: block.objectId,
		parentId: block.parentId,
		type: block.type,
		style: block.style,
		text: block.text,
		linkTargetId: block.linkTargetId,
		createdAt: block.createdAt.toISOString(),
		updatedAt: block.updatedAt.toISOString(),
	};
}
