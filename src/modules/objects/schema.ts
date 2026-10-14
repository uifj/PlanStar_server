import z from "zod";
import { ListQuerySchema, SortOrderSchema } from "../../pagination/index.js";
import {
	DEFAULT_OBJECT_SORT_ORDER,
	MAX_FILTER_JSON_LENGTH,
	OBJECT_LAYOUTS,
} from "./constants.js";
import { FILTER_OPERATORS, type ObjectFilterGroup } from "./filters.js";

const FilterConditionSchema = z.object({
	key: z.string().min(1),
	operator: z.enum(FILTER_OPERATORS),
	value: z.unknown().optional(),
});

const FilterGroupSchema: z.ZodType<ObjectFilterGroup> = z.lazy(() =>
	z.object({
		conjunction: z.enum(["and", "or"]),
		filters: z.array(z.union([FilterConditionSchema, FilterGroupSchema])),
	}),
);

export const ObjectSortSchema = z.object({
	key: z.string().min(1),
	order: SortOrderSchema,
});

export const SortsPayloadSchema = z.array(ObjectSortSchema).max(10);

export const FiltersPayloadSchema = z.array(
	z.union([FilterConditionSchema, FilterGroupSchema]),
);

export const ObjectDetailsSchema = z
	.record(z.string(), z.unknown())
	.meta({ id: "ObjectDetails" });

export const ObjectSchema = z
	.object({
		id: z.string(),
		spaceId: z.string(),
		typeId: z.string().nullable(),
		layout: z.enum(OBJECT_LAYOUTS).nullable(),
		resolvedLayout: z.enum(OBJECT_LAYOUTS),
		name: z.string(),
		description: z.string().nullable(),
		snippet: z.string().nullable(),
		iconEmoji: z.string().nullable(),
		details: ObjectDetailsSchema,
		isArchived: z.boolean(),
		isDeleted: z.boolean(),
		isHidden: z.boolean(),
		isFavorite: z.boolean(),
		done: z.boolean().nullable(),
		creatorId: z.string().nullable(),
		createdAt: z.iso.datetime(),
		updatedAt: z.iso.datetime(),
	})
	.meta({ id: "Object" });

const CreateObjectFields = z.object({
	typeId: z.string().optional(),
	name: z.string().trim().max(300).default(""),
	description: z.string().trim().max(2000).optional(),
	snippet: z.string().trim().max(2000).optional(),
	iconEmoji: z.string().trim().max(8).optional(),
	details: ObjectDetailsSchema.optional(),
	done: z.boolean().optional(),
	isFavorite: z.boolean().optional(),
});

export const CreateObjectSchema = CreateObjectFields.meta({
	id: "CreateObjectInput",
});

export const UpdateObjectSchema = CreateObjectFields.partial()
	.extend({
		details: z.record(z.string(), z.unknown().nullable()).optional(),
	})
	.meta({ id: "UpdateObjectInput" });

export const ObjectParamsSchema = z.object({
	objectId: z.string(),
});

export const SpaceIdParamsSchema = z.object({
	spaceId: z.string(),
});

export const ObjectListQuerySchema = ListQuerySchema.extend({
	filters: z.string().max(MAX_FILTER_JSON_LENGTH).optional(),
	layout: z.enum(OBJECT_LAYOUTS).optional(),
	typeId: z.string().optional(),
	order: SortOrderSchema.default(DEFAULT_OBJECT_SORT_ORDER),
}).meta({ id: "ObjectListQuery" });

// Backlinks are ordered by the link's own index, so only paging is configurable.
export const BacklinkListQuerySchema = ListQuerySchema.pick({
	page: true,
	limit: true,
}).meta({ id: "BacklinkListQuery" });

export type CreateObjectInput = z.infer<typeof CreateObjectSchema>;
export type UpdateObjectInput = z.infer<typeof UpdateObjectSchema>;
export type ObjectListQuery = z.infer<typeof ObjectListQuerySchema>;
export type BacklinkListQuery = z.infer<typeof BacklinkListQuerySchema>;
