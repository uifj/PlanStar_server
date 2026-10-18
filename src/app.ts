import { OpenAPIHono } from "@hono/zod-openapi";
import { API_PREFIX } from "./config/constants.js";
import { isDevelopment } from "./config/env.js";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler } from "./middleware/error.js";
import { loggerMiddleware } from "./middleware/logger.js";
import { notFound } from "./middleware/not-found.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { openApiDocument, scalarConfig } from "./openapi/config.js";
import { markSupersededOperations } from "./openapi/deprecations.js";
import routes from "./routes/index.js";

const base = new OpenAPIHono().basePath(API_PREFIX);
base.use("*", corsMiddleware);
base.use("*", requestIdMiddleware);
base.use("*", loggerMiddleware);

const app = base.route("/", routes);

if (isDevelopment) {
	// Not app.doc(): the document has to carry the deprecation marks, and the generator offers no
	// per-operation hook.
	app.get("/openapi.json", (c) =>
		c.json(markSupersededOperations(app.getOpenAPIDocument(openApiDocument))),
	);
	app.get("/docs", scalarConfig);
}

app.notFound(notFound);

app.onError(errorHandler);

export default app;
