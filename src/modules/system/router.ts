import { OpenAPIHono } from "@hono/zod-openapi";
import { APP_STATUS } from "./constants.js";
import { healthRoute, readyRoute, rootRoute } from "./routes.js";
import { getApplicationInfo, getHealth, getReadiness } from "./service.js";

export const systemRouter = new OpenAPIHono();

systemRouter.openapi(rootRoute, (c) => {
	const info = getApplicationInfo();
	return c.json(info, 200);
});

systemRouter.openapi(healthRoute, (c) => {
	const health = getHealth();
	return c.json(health, 200);
});

systemRouter.openapi(readyRoute, async (c) => {
	const result = await getReadiness();
	if (result.status === APP_STATUS.READY) {
		return c.json(result, 200);
	}
	return c.json(result, 503);
});
