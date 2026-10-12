import z from "zod";
import { ListQuerySchema, SortOrderSchema } from "../../pagination/index.js";
import {
	DEFAULT_VAN_SORT_FIELD,
	DEFAULT_VAN_SORT_ORDER,
	VAN_SORT_FIELDS,
	VAN_TYPES,
} from "./constants.js";

export const VanTypeSchema = z.enum(VAN_TYPES);

export const VanSummarySchema = z
	.object({
		id: z.string(),
		name: z.string(),
		price: z.number(),
		imageUrl: z.url(),
		type: VanTypeSchema,
		location: z.string(),
		sleeps: z.number(),
		rating: z.number(),
	})
	.meta({ id: "VanSummary" });

export const VanSchema = VanSummarySchema.extend({
	description: z.string(),
	amenities: z.array(z.string()),
}).meta({ id: "Van" });

export const VanListQuerySchema = ListQuerySchema.extend({
	type: VanTypeSchema.optional(),
	search: z.string().trim().optional(),
	sort: z.enum(VAN_SORT_FIELDS).default(DEFAULT_VAN_SORT_FIELD),
	order: SortOrderSchema.default(DEFAULT_VAN_SORT_ORDER),
}).meta({ id: "VanListQuery" });

export const VanParamsSchema = z.object({
	id: z.string(),
});

export type VanListQuery = z.infer<typeof VanListQuerySchema>;
