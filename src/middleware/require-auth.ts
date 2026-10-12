import type { MiddlewareHandler } from "hono";
import { UnauthorizedError } from "../errors/http-errors.js";

export const requireAuth: MiddlewareHandler = async (c, next) => {
	if (!c.get("user")) {
		throw new UnauthorizedError();
	}

	await next();
};
