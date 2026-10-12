import pkg from "../../package.json" with { type: "json" };
import { env } from "./env.js";

export const APP_NAME = "VanLife API";
export const APP_VERSION = pkg.version;
export const API_PREFIX = "/api";

export const OPEN_API_VERSION = "3.2.0";

/**
 * Origins allowed to hold a session cookie (Better Auth) and to cross the CORS
 * boundary. Both layers must agree, otherwise a trusted client gets a cookie it
 * cannot read from a WebView.
 */
export const TRUSTED_ORIGINS = [
	env.CLIENT_URL,
	"myapp://", // Flutter deep-link callback scheme (client scheme:'myapp' + expo-origin)
	env.APP_URL, // the API's own origin, matching the Better Auth baseURL
];

export const PAGINATION = {
	DEFAULT_LIMIT: 10,
	MAX_LIMIT: 100,
} as const;
