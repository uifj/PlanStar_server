import { cors } from "hono/cors";
import { env } from "../config/env.js";

export const corsMiddleware = cors({
	origin: env.CLIENT_URL,
	credentials: true,
});
