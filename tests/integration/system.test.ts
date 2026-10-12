import { describe, expect, it } from "vitest";
import {
	API_PREFIX,
	APP_NAME,
	APP_VERSION,
} from "../../src/config/constants.js";
import { APP_STATUS } from "../../src/modules/system/constants.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { api } from "./helpers/path.js";
import { get } from "./helpers/request.js";

describe("System routes", () => {
	describe("GET /", () => {
		it("returns API information", async () => {
			const response = await get(API_PREFIX);

			expect(response.status).toBe(200);

			expect(await response.json()).toEqual({
				name: APP_NAME,
				status: APP_STATUS.RUNNING,
				version: APP_VERSION,
				docs: `${API_PREFIX}/docs`,
			});
		});
	});

	describe("GET /health", () => {
		it("returns health status", async () => {
			const response = await get(api.health);

			expect(response.status).toBe(200);

			expect(await response.json()).toEqual({
				status: APP_STATUS.OK,
			});
		});
	});

	describe("GET /ready", () => {
		it("returns readiness status for the database", async () => {
			const databaseAvailable = await isDatabaseAvailable();
			const response = await get(api.ready);

			expect(response.status).toBe(databaseAvailable ? 200 : 503);

			expect(await response.json()).toEqual({
				status: databaseAvailable ? APP_STATUS.READY : APP_STATUS.NOT_READY,
			});
		});
	});
});
