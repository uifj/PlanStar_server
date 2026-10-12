import type { MiddlewareHandler } from "hono";

const REQUEST_ID_HEADER = "X-Request-Id";

export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
	const requestId = c.req.header(REQUEST_ID_HEADER) ?? crypto.randomUUID();

	c.set("requestId", requestId);

	await next();

	c.header(REQUEST_ID_HEADER, requestId);
};
