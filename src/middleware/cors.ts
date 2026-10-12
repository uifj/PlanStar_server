import { cors } from "hono/cors";
import { TRUSTED_ORIGINS } from "../config/constants.js";

export const corsMiddleware = cors({
	origin: (origin) =>
		origin && TRUSTED_ORIGINS.includes(origin) ? origin : undefined,
	credentials: true,
});
