import { NotFoundError, ValidationError } from "../../errors/http-errors.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuthUser } from "../../lib/auth.js";
import { objectService } from "../objects/service.js";
import { DOCUMENT_LAYOUTS } from "./constants.js";
import { toBlock } from "./dto.js";
import { mintPosition } from "./positions.js";
import { blockRepository } from "./repository.js";
import type { CreateBlockInput, UpdateBlockInput } from "./schema.js";

interface PlacementInput {
	parentId?: string | null;
	afterBlockId?: string | null;
}

/**
 * Where a block lands in a list: an absent anchor appends, a null anchor goes to
 * the front, and a block id lands right after it. The index is always minted
 * between the resulting neighbours (ADR-0013), so clients never send one.
 */
async function resolvePlacement(objectId: string, input: PlacementInput) {
	if (input.parentId) {
		const parent = await blockRepository.findPlacement(
			objectId,
			input.parentId,
		);

		if (!parent) {
			throw new ValidationError(`Unknown block: ${input.parentId}`);
		}
	}

	const parentId = input.parentId ?? null;

	if (input.afterBlockId === undefined) {
		const last = await blockRepository.findChildIndex(objectId, parentId);

		return { parentId, index: mintPosition(last, null) };
	}

	if (input.afterBlockId === null) {
		const first = await blockRepository.findNextIndex(objectId, parentId, "");

		return { parentId, index: mintPosition(null, first) };
	}

	const anchor = await blockRepository.findPlacement(
		objectId,
		input.afterBlockId,
	);

	if (!anchor) {
		throw new ValidationError(`Unknown block: ${input.afterBlockId}`);
	}

	if (input.parentId && input.parentId !== anchor.parentId) {
		throw new ValidationError(
			"A block cannot name both a parent and an anchor in another list.",
		);
	}

	const next = await blockRepository.findNextIndex(
		objectId,
		anchor.parentId,
		anchor.index,
	);

	return {
		parentId: anchor.parentId,
		index: mintPosition(anchor.index, next),
	};
}

async function list(user: AuthUser, objectId: string) {
	// Reading the page object first gives the ADR-0006 not-found semantics for free.
	await objectService.findById(user, objectId);

	const blocks = await blockRepository.findByDocument(objectId);

	return { data: blocks.map(toBlock) };
}

async function create(
	user: AuthUser,
	objectId: string,
	input: CreateBlockInput,
) {
	const document = await objectService.assertEditable(user, objectId);

	// A saved view or a registry mirror has no body to write into (ADR-0013).
	if (!DOCUMENT_LAYOUTS.includes(document.resolvedLayout)) {
		throw new ValidationError(
			`Objects with the ${document.resolvedLayout} layout cannot hold blocks.`,
		);
	}

	const placement = await resolvePlacement(objectId, input);
	const linkTargetId = input.type === "link" ? input.linkTargetId : null;

	if (linkTargetId) {
		const known = await blockRepository.findIdsInSpace(document.spaceId, [
			linkTargetId,
		]);

		if (!known.has(linkTargetId)) {
			throw new ValidationError(`Unknown object: ${linkTargetId}`);
		}
	}

	const block = await blockRepository.create({
		objectId,
		parentId: placement.parentId,
		type: input.type,
		style: input.type === "text" ? input.style : "paragraph",
		text: input.text,
		linkTargetId,
		index: placement.index,
	});

	if (linkTargetId) {
		await blockRepository.syncEdges(document.spaceId, objectId);
	}

	return toBlock(block);
}

async function update(
	user: AuthUser,
	blockId: string,
	input: UpdateBlockInput,
) {
	const block = await blockRepository.findById(blockId);

	if (!block) {
		throw new NotFoundError("Block not found.");
	}

	await objectService.assertEditable(user, block.objectId);

	const fields: Prisma.BlockUncheckedUpdateInput = {};

	if (input.text !== undefined) fields.text = input.text;
	if (input.style !== undefined) fields.style = input.style;

	if (input.afterBlockId !== undefined) {
		const placement = await resolvePlacement(block.objectId, {
			parentId: input.parentId,
			afterBlockId: input.afterBlockId,
		});

		fields.parentId = placement.parentId;
		fields.index = placement.index;
	}

	const updated = await blockRepository.update(block.id, fields);

	return toBlock(updated);
}

async function remove(user: AuthUser, blockId: string) {
	const block = await blockRepository.findById(blockId);

	if (!block) {
		throw new NotFoundError("Block not found.");
	}

	const document = await objectService.assertEditable(user, block.objectId);

	await blockRepository.deleteById(block.id);

	if (block.type === "link") {
		await blockRepository.syncEdges(document.spaceId, block.objectId);
	}
}

export const blockService = {
	list,
	create,
	update,
	remove,
};
