import { describe, expect, it } from "vitest";
import { getSorting } from "../../../src/pagination/sorting.js";

const options = {
	defaultField: "createdAt",
	defaultOrder: "desc",
} as const;

describe("getSorting", () => {
	it("returns the default sort field when sort is undefined", () => {
		// Act
		const result = getSorting(undefined, "desc", options);

		// Assert
		expect(result).toEqual({
			orderBy: {
				createdAt: "desc",
			},
		});
	});

	it("uses the provided sort field", () => {
		// Act
		const result = getSorting("title", "desc", options);

		// Assert
		expect(result).toEqual({
			orderBy: {
				title: "desc",
			},
		});
	});

	it("uses the provided order", () => {
		// Act
		const result = getSorting("title", "asc", options);

		// Assert
		expect(result).toEqual({
			orderBy: {
				title: "asc",
			},
		});
	});
});
