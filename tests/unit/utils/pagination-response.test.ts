import { describe, expect, it } from "vitest";
import z from "zod";
import { createPaginatedResponseSchema } from "../../../src/pagination/response.js";

describe("createPaginatedResponseSchema", () => {
	it("creates a schema for paginated item responses", () => {
		// Arrange
		const schema = createPaginatedResponseSchema(
			z.object({
				id: z.string(),
			}),
		);

		// Act
		const result = schema.parse({
			data: [{ id: "van_1" }],
			meta: {
				page: 1,
				limit: 10,
				total: 1,
				totalPages: 1,
			},
		});

		// Assert
		expect(result).toEqual({
			data: [{ id: "van_1" }],
			meta: {
				page: 1,
				limit: 10,
				total: 1,
				totalPages: 1,
			},
		});
	});
});
