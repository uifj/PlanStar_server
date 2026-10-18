import { OpenAPIHono } from "@hono/zod-openapi";
import { readPublished } from "../command/publishing-service.js";

// The public publish gateway. PublishingCreate returns `${APP_URL}/api/publish/<slug>` and the
// client opens it with Action.openUrl (menu/publish.tsx:80), so this route is deliberately
// unauthenticated: a published object is world-readable. It serves the object's projected content
// as JSON, decoding the body from its stored Yjs document. Mounted at /publish under the /api base.
export const publishRouter = new OpenAPIHono();

publishRouter.get("/:uri", async (c) => {
	const content = await readPublished(c.req.param("uri"));
	if (!content) {
		return c.notFound();
	}
	return c.json(content, 200);
});
