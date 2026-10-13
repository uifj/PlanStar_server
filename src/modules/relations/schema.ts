import z from "zod";
import { ListQuerySchema, SortOrderSchema } from "../../pagination/index.js";
import {
	DEFAULT_RELATION_SORT_FIELD,
	DEFAULT_RELATION_SORT_ORDER,
	RELATION_FORMATS,
	RELATION_SORT_FIELDS,
	RELATION_UNIQUE_KEY_PATTERN,
} from "./constants.js";

export const RelationFormatSchema = z.enum(RELATION_FORMATS);

export const RelationSchema = z
	.object({
		id: z.string(),
		spaceId: z.string(),
		typeId: z.string().nullable(),
		uniqueKey: z.string(),
		format: RelationFormatSchema,
		name: z.string(),
		description: z.string().nullable(),
		isReadOnly: z.boolean(),
		isHidden: z.boolean(),
		maxCount: z.number().nullable(),
		createdAt: z.iso.datetime(),
		updatedAt: z.iso.datetime(),
	})
	.meta({ id: "Relation" });

export const CreateRelationSchema = z
	.object({
		uniqueKey: z
			.string()
			.trim()
			.regex(
				RELATION_UNIQUE_KEY_PATTERN,
				"Relation keys start with a lowercase letter and use letters and digits only.",
			),
		format: RelationFormatSchema,
		name: z.string().trim().min(1, "Relation name is required.").max(120),
		description: z.string().trim().max(500).optional(),
		maxCount: z.number().int().min(1).max(999).optional(),
		typeId: z.string().optional(),
	})
	.meta({ id: "CreateRelationInput" });

export const SpaceIdParamsSchema = z.object({
	spaceId: z.string(),
});

export const RelationListQuerySchema = ListQuerySchema.extend({
	typeId: z.string().optional(),
	sort: z.enum(RELATION_SORT_FIELDS).default(DEFAULT_RELATION_SORT_FIELD),
	order: SortOrderSchema.default(DEFAULT_RELATION_SORT_ORDER),
}).meta({ id: "RelationListQuery" });

export type CreateRelationInput = z.infer<typeof CreateRelationSchema>;
export type RelationListQuery = z.infer<typeof RelationListQuerySchema>;
