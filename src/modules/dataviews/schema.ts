import z from "zod";
import { ListQuerySchema, SortOrderSchema } from "../../pagination/index.js";
import { createPaginatedResponseSchema } from "../../pagination/response.js";
import {
	FiltersPayloadSchema,
	ObjectSchema,
	ObjectSortSchema,
} from "../objects/schema.js";
import { DATAVIEW_VIEW_TYPES } from "./constants.js";

export const DataviewViewTypeSchema = z.enum(DATAVIEW_VIEW_TYPES);

// A filter tree nests to any depth, and the OpenAPI converter refuses a recursive
// schema, so the route documents free-form clauses and objectService.validateQuery
// checks the real shape (ADR-0007, ADR-0012).
const ClausesSchema = z
	.array(z.record(z.string(), z.unknown()))
	.meta({ id: "DataviewClauses" });

export const CreateDataviewSchema = z
	.object({
		name: z.string().trim().min(1, "View name is required.").max(120),
		sourceTypeId: z.string().min(1),
		viewType: DataviewViewTypeSchema.default("grid"),
		coverRelationKey: z.string().min(1).optional(),
		groupRelationKey: z.string().min(1).optional(),
		filters: ClausesSchema.default([]),
		sorts: z
			.array(
				z.object({
					key: z.string().min(1),
					order: SortOrderSchema,
				}),
			)
			.max(10)
			.default([]),
	})
	.meta({ id: "CreateDataviewInput" });

// What the layout menu writes. A null clears a key, so a board can stop grouping.
export const UpdateDataviewSchema = z
	.object({
		viewType: DataviewViewTypeSchema.optional(),
		coverRelationKey: z.string().min(1).nullish(),
		groupRelationKey: z.string().min(1).nullish(),
		// A view's query can be rewritten too, so a saved view stays the whole
		// statement rather than a layout wearing stale filters (ADR-0012).
		filters: ClausesSchema.optional(),
		sorts: z
			.array(
				z.object({
					key: z.string().min(1),
					order: SortOrderSchema,
				}),
			)
			.max(10)
			.optional(),
	})
	.meta({ id: "UpdateDataviewInput" });

// What a stored view's details map must look like (ADR-0012). Runtime only, so it
// can keep the recursive filter shape.
export const ViewConfigSchema = z.object({
	viewType: z.string(),
	dataviewFilters: FiltersPayloadSchema.default([]),
	dataviewSorts: z.array(ObjectSortSchema).default([]),
});

export const DataviewCreateParamsSchema = z.object({
	spaceId: z.string(),
});
export const DataviewParamsSchema = z.object({
	spaceId: z.string(),
	dataviewId: z.string(),
});

export const DataviewRecordsQuerySchema = ListQuerySchema.pick({
	page: true,
	limit: true,
}).meta({ id: "DataviewRecordsQuery" });

export const DataviewRecordsResponseSchema = createPaginatedResponseSchema(
	ObjectSchema,
)
	.extend({
		counters: z
			.object({
				matched: z.number(),
				total: z.number(),
			})
			.meta({ id: "ViewCounters" }),
	})
	.meta({ id: "DataviewRecordsResponse" });

export type CreateDataviewInput = z.infer<typeof CreateDataviewSchema>;
export type DataviewRecordsQuery = z.infer<typeof DataviewRecordsQuerySchema>;
export type UpdateDataviewInput = z.infer<typeof UpdateDataviewSchema>;
