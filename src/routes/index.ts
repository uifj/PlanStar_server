import { OpenAPIHono } from "@hono/zod-openapi";
import { agentProtocolRouter, agentRouter } from "../modules/agent/router.js";
import { authRouter } from "../modules/auth/router.js";
import { bookingsRouter } from "../modules/bookings/router.js";
import { hostRouter } from "../modules/host/router.js";
import { meRouter } from "../modules/me/router.js";
import { reviewsRouter } from "../modules/reviews/router.js";
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
routes.route("/agent", agentRouter);
routes.route("/ai", agentProtocolRouter);

export default routes;
