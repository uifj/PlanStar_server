import type { Context } from "hono";

export function notFound(c: Context) {
	return c.json({ message: "Route not found" }, 404);
}
