import z from "zod";
import { BLOCK_STYLES, BLOCK_TYPES } from "./constants.js";

export const BlockSchema = z
	.object({
		id: z.string(),
		objectId: z.string(),
		parentId: z.string().nullable(),
		type: z.enum(BLOCK_TYPES),
		style: z.enum(BLOCK_STYLES),
		text: z.string(),
		linkTargetId: z.string().nullable(),
		createdAt: z.iso.datetime(),
		updatedAt: z.iso.datetime(),
	})
	.meta({ id: "Block" });

// A document body is read whole, so this list carries no page meta (ADR-0013).
export const BlockListResponseSchema = z
	.object({
		data: z.array(BlockSchema),
	})
	.meta({ id: "BlockListResponse" });

export const ObjectIdParamsSchema = z.object({
	objectId: z.string(),
});

const BlockPlacementSchema = {
	parentId: z.string().optional(),
	afterBlockId: z.string().nullable().optional(),
};

export const CreateBlockSchema = z
	.discriminatedUnion("type", [
		z.object({
			type: z.literal("text"),
			style: z.enum(BLOCK_STYLES).default("paragraph"),
			text: z.string().max(20_000).default(""),
			...BlockPlacementSchema,
		}),
		z.object({
			type: z.literal("link"),
			linkTargetId: z.string().min(1),
			text: z.string().max(20_000).default(""),
			...BlockPlacementSchema,
		}),
	])
	.meta({ id: "CreateBlockInput" });

export const UpdateBlockSchema = z
	.object({
		text: z.string().max(20_000).optional(),
		style: z.enum(BLOCK_STYLES).optional(),
		parentId: z.string().nullable().optional(),
		afterBlockId: z.string().nullable().optional(),
	})
	.meta({ id: "UpdateBlockInput" });

export const BlockIdParamsSchema = z.object({
	blockId: z.string(),
});

export type CreateBlockInput = z.infer<typeof CreateBlockSchema>;
export type UpdateBlockInput = z.infer<typeof UpdateBlockSchema>;
export type BlockListItem = z.infer<typeof BlockSchema>;
