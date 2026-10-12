import { describe, expect, it, vi } from "vitest";
import {
	API_PREFIX,
	APP_NAME,
	APP_VERSION,
} from "../../../src/config/constants.js";
import { prisma } from "../../../src/lib/prisma.js";
import { APP_STATUS } from "../../../src/modules/system/constants.js";
import { systemRouter } from "../../../src/modules/system/router.js";
import {
	getApplicationInfo,
	getHealth,
	getReadiness,
} from "../../../src/modules/system/service.js";

describe("system service", () => {
	it("returns application information", () => {
		// Act
		const result = getApplicationInfo();

		// Assert
		expect(result).toEqual({
			name: APP_NAME,
			version: APP_VERSION,
			status: APP_STATUS.RUNNING,
			docs: `${API_PREFIX}/docs`,
		});
	});

	it("returns health status", () => {
		// Act
		const result = getHealth();

		// Assert
		expect(result).toEqual({
			status: APP_STATUS.OK,
		});
	});

	it("returns ready when the database query succeeds", async () => {
		// Arrange
		vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);

		// Act
		const result = await getReadiness();

		// Assert
		expect(prisma.$queryRaw).toHaveBeenCalledOnce();
		expect(result).toEqual({
			status: APP_STATUS.READY,
		});
	});

	it("returns not ready when the database query fails", async () => {
		// Arrange
		vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("Database down"));

		// Act
		const result = await getReadiness();

		// Assert
		expect(prisma.$queryRaw).toHaveBeenCalledOnce();
		expect(result).toEqual({
			status: APP_STATUS.NOT_READY,
		});
	});
});

describe("systemRouter", () => {
	it("returns application information", async () => {
		// Act
		const response = await systemRouter.request("/");

		// Assert
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			name: APP_NAME,
			version: APP_VERSION,
			status: APP_STATUS.RUNNING,
			docs: `${API_PREFIX}/docs`,
		});
	});

	it("returns health status", async () => {
		// Act
		const response = await systemRouter.request("/health");

		// Assert
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			status: APP_STATUS.OK,
		});
	});

	it("returns 200 when ready", async () => {
		// Arrange
		vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);

		// Act
		const response = await systemRouter.request("/ready");

		// Assert
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			status: APP_STATUS.READY,
		});
	});

	it("returns 503 when not ready", async () => {
		// Arrange
		vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("Database down"));

		// Act
		const response = await systemRouter.request("/ready");

		// Assert
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			status: APP_STATUS.NOT_READY,
		});
	});
});
