import { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "../lib/auth.js";
import { requireAuth } from "../middleware/require-auth.js";
import { sessionMiddleware } from "../middleware/session.js";

export function createProtectedRouter() {
	const router = new OpenAPIHono<{ Variables: AuthType }>();

	router.use("*", sessionMiddleware);
	router.use("*", requireAuth);

	return router;
}
