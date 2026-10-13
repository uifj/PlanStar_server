import { getCurrentUser } from "../../auth/current-user.js";
import { createProtectedRouter } from "../../auth/protected-router.js";
import { paginated } from "../../response/payload.js";
import { createRelationRoute, listRelationsRoute } from "./routes.js";
import { relationService } from "./service.js";

export const relationsRouter = createProtectedRouter();

relationsRouter.openapi(listRelationsRoute, async (c) => {
	const { spaceId } = c.req.valid("param");
	const query = c.req.valid("query");
	const user = getCurrentUser(c);

	const relations = await relationService.findMany(user, spaceId, query);

	return c.json(paginated(relations.data, relations.meta));
});

relationsRouter.openapi(createRelationRoute, async (c) => {
	const { spaceId } = c.req.valid("param");
	const body = c.req.valid("json");
	const user = getCurrentUser(c);

	const relation = await relationService.create(user, spaceId, body);

	return c.json(relation, 201);
});
