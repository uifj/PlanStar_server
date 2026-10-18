import { OpenAPIHono } from "@hono/zod-openapi";
import { agentProtocolRouter, agentRouter } from "../modules/agent/router.js";
import { authRouter } from "../modules/auth/router.js";
import { blocksRouter, objectBlocksRouter } from "../modules/blocks/router.js";
import { bookingsRouter } from "../modules/bookings/router.js";
import { commandRouter } from "../modules/command/router.js";
import { dataviewsRouter } from "../modules/dataviews/router.js";
import { filesRouter } from "../modules/files/router.js";
import { hostRouter } from "../modules/host/router.js";
import { meRouter } from "../modules/me/router.js";
import { objectTypesRouter } from "../modules/object-types/router.js";
import {
	objectsRouter,
	spaceObjectsRouter,
} from "../modules/objects/router.js";
import { publishRouter } from "../modules/publish/router.js";
import { pubsubRouter } from "../modules/pubsub/router.js";
import { relationsRouter } from "../modules/relations/router.js";
import { reviewsRouter } from "../modules/reviews/router.js";
import { spacesRouter } from "../modules/spaces/router.js";
import { systemRouter } from "../modules/system/router.js";
import { vansRouter } from "../modules/vans/router.js";

const routes = new OpenAPIHono()
	.route("/", systemRouter)
	.route("/", authRouter)
	.route("/me", meRouter)
	.route("/vans", vansRouter)
	.route("/bookings", bookingsRouter)
	.route("/reviews", reviewsRouter)
	.route("/host", hostRouter)
	.route("/spaces", spacesRouter)
	.route("/spaces", relationsRouter)
	.route("/spaces", objectTypesRouter)
	.route("/spaces", spaceObjectsRouter)
	.route("/spaces", dataviewsRouter)
	.route("/objects", objectsRouter)
	.route("/objects", objectBlocksRouter)
	.route("/blocks", blocksRouter)
	.route("/command", commandRouter)
	.route("/publish", publishRouter)
	.route("/events", pubsubRouter)
	.route("/", filesRouter)
	.route("/agent", agentRouter)
	.route("/ai", agentProtocolRouter);

export default routes;
