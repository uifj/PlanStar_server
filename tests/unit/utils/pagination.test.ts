import { describe, expect, it } from "vitest";
import { getPagination } from "../../../src/pagination/pagination.js";

describe("getPagination", () => {
	it("calculates pagination for the first page", () => {
		// Act
		const result = getPagination({
			page: 1,
			limit: 10,
		});

		// Assert
		expect(result).toEqual({
			skip: 0,
			take: 10,
		});
	});

	it("calculates pagination for subsequent pages", () => {
		// Act
		const result = getPagination({
			page: 3,
			limit: 10,
		});

		// Assert
		expect(result).toEqual({
			skip: 20,
			take: 10,
		});
	});

	it("supports a custom page size", () => {
		// Act
		const result = getPagination({
			page: 2,
			limit: 25,
		});

		// Assert
		expect(result).toEqual({
			skip: 25,
			take: 25,
		});
	});
});
