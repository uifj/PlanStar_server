import z, { type ZodType } from "zod";
import { PaginationMetaSchema } from "./schema.js";

export function createPaginatedResponseSchema<T extends ZodType>(
	itemSchema: T,
) {
	return z.object({
		data: z.array(itemSchema),
		meta: PaginationMetaSchema,
	});
}
