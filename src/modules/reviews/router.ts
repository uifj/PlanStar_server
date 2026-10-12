import { getCurrentUser } from "../../auth/current-user.js";
import { createProtectedRouter } from "../../auth/protected-router.js";
import { createReviewRoute } from "./routes.js";
import { reviewService } from "./service.js";

export const reviewsRouter = createProtectedRouter();

reviewsRouter.openapi(createReviewRoute, async (c) => {
	const body = c.req.valid("json");
	const user = getCurrentUser(c);

	const review = await reviewService.create(user, body);

	return c.json(review, 201);
});
