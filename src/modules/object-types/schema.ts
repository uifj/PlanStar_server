import z from "zod";
import { ListQuerySchema, SortOrderSchema } from "../../pagination/index.js";
import {
	DEFAULT_OBJECT_TYPE_SORT_FIELD,
	DEFAULT_OBJECT_TYPE_SORT_ORDER,
	OBJECT_TYPE_SORT_FIELDS,
	OBJECT_TYPE_UNIQUE_KEY_PATTERN,
} from "./constants.js";

export const ObjectTypeSchema = z
	.object({
		id: z.string(),
		spaceId: z.string(),
		uniqueKey: z.string(),
		name: z.string(),
		description: z.string().nullable(),
		iconEmoji: z.string().nullable(),
		layout: z.string(),
		relationKeys: z.array(z.string()),
		createdAt: z.iso.datetime(),
		updatedAt: z.iso.datetime(),
	})
	.meta({ id: "ObjectType" });

export const CreateObjectTypeSchema = z
	.object({
		uniqueKey: z
			.string()
			.trim()
			.regex(
				OBJECT_TYPE_UNIQUE_KEY_PATTERN,
				"Type keys start with a lowercase letter and use letters and digits only.",
			),
		name: z.string().trim().min(1, "Type name is required.").max(120),
		description: z.string().trim().max(500).optional(),
		iconEmoji: z.string().trim().max(8).optional(),
		relationKeys: z.array(z.string().trim().min(1)).max(100).optional(),
	})
	.meta({ id: "CreateObjectTypeInput" });

export const SpaceIdParamsSchema = z.object({
	spaceId: z.string(),
});

export const ObjectTypeListQuerySchema = ListQuerySchema.extend({
	search: z.string().trim().optional(),
	sort: z.enum(OBJECT_TYPE_SORT_FIELDS).default(DEFAULT_OBJECT_TYPE_SORT_FIELD),
	order: SortOrderSchema.default(DEFAULT_OBJECT_TYPE_SORT_ORDER),
}).meta({ id: "ObjectTypeListQuery" });

export type CreateObjectTypeInput = z.infer<typeof CreateObjectTypeSchema>;
export type ObjectTypeListQuery = z.infer<typeof ObjectTypeListQuerySchema>;
