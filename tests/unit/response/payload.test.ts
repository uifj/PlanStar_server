import { describe, expect, it } from "vitest";
import { paginated } from "../../../src/response/payload.js";

describe("response payload helpers", () => {
	it("wraps a collection with pagination metadata", () => {
		// Arrange
		const meta = {
			page: 2,
			limit: 10,
			total: 25,
			totalPages: 3,
			hasNextPage: true,
			hasPreviousPage: true,
		};

		// Act
		const result = paginated([{ id: "van_1" }], meta);

		// Assert
		expect(result).toEqual({
			data: [{ id: "van_1" }],
			meta,
		});
	});
});
