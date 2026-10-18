import { getCurrentUser } from "../../auth/current-user.js";
import { createProtectedRouter } from "../../auth/protected-router.js";
import { paginated } from "../../response/payload.js";
import {
	createDataviewRoute,
	listDataviewRecordsRoute,
	updateDataviewRoute,
} from "./routes.js";
import { dataviewService } from "./service.js";

export const dataviewsRouter = createProtectedRouter();

dataviewsRouter.openapi(createDataviewRoute, async (c) => {
	const { spaceId } = c.req.valid("param");
	const body = c.req.valid("json");
	const user = getCurrentUser(c);

	const view = await dataviewService.create(user, spaceId, body);

	return c.json(view, 201);
});

dataviewsRouter.openapi(updateDataviewRoute, async (c) => {
	const { spaceId, dataviewId } = c.req.valid("param");
	const body = c.req.valid("json");
	const user = getCurrentUser(c);

	const view = await dataviewService.update(user, spaceId, dataviewId, body);

	return c.json(view, 200);
});

dataviewsRouter.openapi(listDataviewRecordsRoute, async (c) => {
	const { spaceId, dataviewId } = c.req.valid("param");
	const query = c.req.valid("query");
	const user = getCurrentUser(c);

	const records = await dataviewService.records(
		user,
		spaceId,
		dataviewId,
		query,
	);

	return c.json(
		{
			...paginated(records.data, records.meta),
			counters: records.counters,
		},
		200,
	);
});
