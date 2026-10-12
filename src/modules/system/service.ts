import { API_PREFIX, APP_NAME, APP_VERSION } from "../../config/constants.js";
import { prisma } from "../../lib/prisma.js";
import { APP_STATUS } from "./constants.js";

export function getApplicationInfo() {
	return {
		name: APP_NAME,
		version: APP_VERSION,
		status: APP_STATUS.RUNNING,
		docs: `${API_PREFIX}/docs`,
	};
}

export function getHealth() {
	return {
		status: APP_STATUS.OK,
	};
}

export async function getReadiness() {
	try {
		await prisma.$queryRaw`SELECT 1`;

		return {
			status: APP_STATUS.READY,
		};
	} catch {
		return {
			status: APP_STATUS.NOT_READY,
		};
	}
}
