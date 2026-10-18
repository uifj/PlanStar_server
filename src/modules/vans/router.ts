import { OpenAPIHono } from "@hono/zod-openapi";
import { paginated } from "../../response/payload.js";
import { getVanRoute, listVansRoute } from "./routes.js";
import { vanService } from "./service.js";

export const vansRouter = new OpenAPIHono();

vansRouter.openapi(listVansRoute, async (c) => {
	const query = c.req.valid("query");

	const vans = await vanService.findMany(query);

	return c.json(paginated(vans.data, vans.meta), 200);
});

vansRouter.openapi(getVanRoute, async (c) => {
	const { id } = c.req.valid("param");

	const van = await vanService.findById(id);

	return c.json(van, 200);
});
