import type { MiddlewareHandler } from "hono";
import { ServiceUnavailableError } from "../errors/http-errors.js";
import { auth } from "../lib/auth.js";
import { logger } from "../lib/logger.js";

export const sessionMiddleware: MiddlewareHandler = async (c, next) => {
	try {
		const session = await auth.api.getSession({
			headers: c.req.raw.headers,
		});

		c.set("user", session?.user ?? null);
		c.set("session", session?.session ?? null);
	} catch (error) {
		logger.error(
			{
				err: error,
				requestId: c.get("requestId"),
				path: c.req.path,
				method: c.req.method,
			},
			"Failed to retrieve session",
		);

		throw new ServiceUnavailableError(
			"Authentication is temporarily unavailable. Please try again.",
		);
	}

	await next();
};
