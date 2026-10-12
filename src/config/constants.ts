import pkg from "../../package.json" with { type: "json" };

export const APP_NAME = "VanLife API";
export const APP_VERSION = pkg.version;
export const API_PREFIX = "/api";

export const OPEN_API_VERSION = "3.2.0";

export const PAGINATION = {
	DEFAULT_LIMIT: 10,
	MAX_LIMIT: 100,
} as const;
