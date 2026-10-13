import { getCurrentUser } from "../../auth/current-user.js";
import { createProtectedRouter } from "../../auth/protected-router.js";
import { paginated } from "../../response/payload.js";
import { createObjectTypeRoute, listObjectTypesRoute } from "./routes.js";
import { objectTypeService } from "./service.js";

export const objectTypesRouter = createProtectedRouter();

objectTypesRouter.openapi(listObjectTypesRoute, async (c) => {
	const { spaceId } = c.req.valid("param");
	const query = c.req.valid("query");
	const user = getCurrentUser(c);

	const types = await objectTypeService.findMany(user, spaceId, query);

	return c.json(paginated(types.data, types.meta));
});

objectTypesRouter.openapi(createObjectTypeRoute, async (c) => {
	const { spaceId } = c.req.valid("param");
	const body = c.req.valid("json");
	const user = getCurrentUser(c);

	const objectType = await objectTypeService.create(user, spaceId, body);

	return c.json(objectType, 201);
});
