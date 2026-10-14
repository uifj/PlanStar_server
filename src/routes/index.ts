import { OpenAPIHono } from "@hono/zod-openapi";
import { agentProtocolRouter, agentRouter } from "../modules/agent/router.js";
import { authRouter } from "../modules/auth/router.js";
import { blocksRouter, objectBlocksRouter } from "../modules/blocks/router.js";
import { bookingsRouter } from "../modules/bookings/router.js";
import { dataviewsRouter } from "../modules/dataviews/router.js";
import { hostRouter } from "../modules/host/router.js";
import { meRouter } from "../modules/me/router.js";
import { objectTypesRouter } from "../modules/object-types/router.js";
import {
	objectsRouter,
	spaceObjectsRouter,
} from "../modules/objects/router.js";
import { relationsRouter } from "../modules/relations/router.js";
import { reviewsRouter } from "../modules/reviews/router.js";
import { spacesRouter } from "../modules/spaces/router.js";
import { systemRouter } from "../modules/system/router.js";
import { vansRouter } from "../modules/vans/router.js";

const routes = new OpenAPIHono();

routes.route("/", systemRouter);
routes.route("/", authRouter);
routes.route("/me", meRouter);
routes.route("/vans", vansRouter);
routes.route("/bookings", bookingsRouter);
routes.route("/reviews", reviewsRouter);
routes.route("/host", hostRouter);
routes.route("/spaces", spacesRouter);
routes.route("/spaces", relationsRouter);
routes.route("/spaces", objectTypesRouter);
routes.route("/spaces", spaceObjectsRouter);
routes.route("/spaces", dataviewsRouter);
routes.route("/objects", objectsRouter);
routes.route("/objects", objectBlocksRouter);
routes.route("/blocks", blocksRouter);
routes.route("/agent", agentRouter);
routes.route("/ai", agentProtocolRouter);

export default routes;
