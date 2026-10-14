import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "../errors/app-error.js";
import { logger } from "../lib/logger.js";

export function errorHandler(err: Error, c: Context) {
	// Hono raises these for input it rejects before the handler runs, such as a
	// body that is not valid JSON. They are the caller's error, not ours.
	if (err instanceof HTTPException && err.status < 500) {
		logger.warn(
			{
				requestId: c.get("requestId"),
				method: c.req.method,
				path: c.req.path,
				status: err.status,
				err,
			},
			"Request failed",
		);

		return c.json({ message: err.message }, err.status as ContentfulStatusCode);
	}

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
