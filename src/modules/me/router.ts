import { getCurrentUser } from "../../auth/current-user.js";
import { createProtectedRouter } from "../../auth/protected-router.js";
import { currentUserRoute } from "./routes.js";

export const meRouter = createProtectedRouter();

meRouter.openapi(currentUserRoute, (c) => {
	const user = getCurrentUser(c);

	return c.json({
		id: user.id,
		name: user.name,
		email: user.email,
		emailVerified: user.emailVerified,
		image: user.image,
		role: user.role ?? null,
	});
});
