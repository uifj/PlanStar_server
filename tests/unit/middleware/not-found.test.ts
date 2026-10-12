import { describe, expect, it } from "vitest";
import { notFound } from "../../../src/middleware/not-found.js";
import { createErrorContext } from "../../helpers/error-context.js";

describe("notFound", () => {
	it("returns a route not found response", () => {
		// Arrange
		const c = createErrorContext();

		// Act
		const response = notFound(c as never);

		// Assert
		expect(c.json).toHaveBeenCalledWith(
			{
				message: "Route not found",
			},
			404,
		);
		expect(response).toEqual({
			body: {
				message: "Route not found",
			},
			status: 404,
		});
	});
});
