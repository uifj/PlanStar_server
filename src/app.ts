import { OpenAPIHono } from "@hono/zod-openapi";
import { API_PREFIX } from "./config/constants.js";
import { isDevelopment } from "./config/env.js";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler } from "./middleware/error.js";
import { loggerMiddleware } from "./middleware/logger.js";
import { notFound } from "./middleware/not-found.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { openApiDocument, scalarConfig } from "./openapi/config.js";
import routes from "./routes/index.js";

const app = new OpenAPIHono().basePath(API_PREFIX);

app.use("*", corsMiddleware);

app.use("*", requestIdMiddleware);

app.use("*", loggerMiddleware);

app.route("/", routes);

if (isDevelopment) {
	app.doc("/openapi.json", openApiDocument);
	app.get("/docs", scalarConfig);
}

app.notFound(notFound);

app.onError(errorHandler);

export default app;
