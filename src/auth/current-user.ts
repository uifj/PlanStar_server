import type { Context } from "hono";

import { UnauthorizedError } from "../errors/http-errors.js";
import type { AuthType } from "../lib/auth.js";

export function getCurrentUser(c: Context<{ Variables: AuthType }>) {
	const user = c.get("user");

	if (!user) {
		throw new UnauthorizedError();
	}

	return user;
}
