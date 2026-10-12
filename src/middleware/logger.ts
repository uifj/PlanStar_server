import type { MiddlewareHandler } from "hono";
import { logger } from "../lib/logger.js";

export const loggerMiddleware: MiddlewareHandler = async (c, next) => {
	const start = performance.now();

	await next();

	const duration = Number((performance.now() - start).toFixed(2));

	logger.info(
		{
			requestId: c.get("requestId"),
			method: c.req.method,
			path: c.req.path,
			status: c.res.status,
			duration,
		},
		"HTTP Request",
	);
};
