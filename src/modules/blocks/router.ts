import { getCurrentUser } from "../../auth/current-user.js";
import { createProtectedRouter } from "../../auth/protected-router.js";
import {
	createBlockRoute,
	deleteBlockRoute,
	listBlocksRoute,
	updateBlockRoute,
} from "./routes.js";
import { blockService } from "./service.js";

export const objectBlocksRouter = createProtectedRouter();

objectBlocksRouter.openapi(listBlocksRoute, async (c) => {
	const { objectId } = c.req.valid("param");
	const user = getCurrentUser(c);

	const document = await blockService.list(user, objectId);

	return c.json(document);
});

objectBlocksRouter.openapi(createBlockRoute, async (c) => {
	const { objectId } = c.req.valid("param");
	const body = c.req.valid("json");
	const user = getCurrentUser(c);

	const block = await blockService.create(user, objectId, body);

	return c.json(block, 201);
});

export const blocksRouter = createProtectedRouter();

blocksRouter.openapi(updateBlockRoute, async (c) => {
	const { blockId } = c.req.valid("param");
	const body = c.req.valid("json");
	const user = getCurrentUser(c);

	const block = await blockService.update(user, blockId, body);

	return c.json(block);
});

blocksRouter.openapi(deleteBlockRoute, async (c) => {
	const { blockId } = c.req.valid("param");
	const user = getCurrentUser(c);

	await blockService.remove(user, blockId);

	return c.body(null, 204);
});
