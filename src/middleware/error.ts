import type { Context } from "hono";
import { AppError } from "../errors/app-error.js";
import { logger } from "../lib/logger.js";

export function errorHandler(err: Error, c: Context) {
	if (err instanceof AppError) {
		logger.warn(
			{
				requestId: c.get("requestId"),
				method: c.req.method,
				path: c.req.path,
				status: err.statusCode,
				err,
			},
			"Request failed",
		);

		return c.json({ message: err.message }, err.statusCode);
	}

	logger.error(
		{
			requestId: c.get("requestId"),
			method: c.req.method,
			path: c.req.path,
			status: 500,
			err,
		},
		"Unhandled error",
	);

	return c.json({ message: "Internal Server Error" }, 500);
}
