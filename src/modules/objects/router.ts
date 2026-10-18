import { getCurrentUser } from "../../auth/current-user.js";
import { createProtectedRouter } from "../../auth/protected-router.js";
import { paginated } from "../../response/payload.js";
import {
	archiveObjectRoute,
	createObjectRoute,
	getObjectRoute,
	listBacklinksRoute,
	listObjectsRoute,
	updateObjectRoute,
} from "./routes.js";
import { objectService } from "./service.js";

export const objectsRouter = createProtectedRouter();

export const spaceObjectsRouter = createProtectedRouter().openapi(
	listObjectsRoute,
	async (c) => {
		const { spaceId } = c.req.valid("param");
		const query = c.req.valid("query");
		const user = getCurrentUser(c);

		const objects = await objectService.findMany(user, spaceId, query);

		return c.json(paginated(objects.data, objects.meta), 200);
	},
);

spaceObjectsRouter.openapi(createObjectRoute, async (c) => {
	const { spaceId } = c.req.valid("param");
	const body = c.req.valid("json");
	const user = getCurrentUser(c);

	const object = await objectService.create(user, spaceId, body);

	return c.json(object, 201);
});

objectsRouter.openapi(getObjectRoute, async (c) => {
	const { objectId } = c.req.valid("param");
	const user = getCurrentUser(c);

	const object = await objectService.findById(user, objectId);

	return c.json(object, 200);
});

objectsRouter.openapi(listBacklinksRoute, async (c) => {
	const { objectId } = c.req.valid("param");
	const query = c.req.valid("query");
	const user = getCurrentUser(c);

	const backlinks = await objectService.findBacklinks(user, objectId, query);

	return c.json(paginated(backlinks.data, backlinks.meta), 200);
});

objectsRouter.openapi(updateObjectRoute, async (c) => {
	const { objectId } = c.req.valid("param");
	const body = c.req.valid("json");
	const user = getCurrentUser(c);

	const object = await objectService.update(user, objectId, body);

	return c.json(object, 200);
});

objectsRouter.openapi(archiveObjectRoute, async (c) => {
	const { objectId } = c.req.valid("param");
	const user = getCurrentUser(c);

	await objectService.archive(user, objectId);

	return c.body(null, 204);
});
