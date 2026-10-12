import { describe, expect, it } from "vitest";
import { API_PREFIX } from "../../src/config/constants.js";
import { get } from "./helpers/request.js";

describe("Not Found routes", () => {
	it("returns 404 for unknown routes", async () => {
		// Act
		const response = await get(`${API_PREFIX}/unknown`);

		// Assert
		expect(response.status).toBe(404);

		expect(await response.json()).toEqual({
			message: "Route not found",
		});
	});
});
