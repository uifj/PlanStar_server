import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import {
	API_PREFIX,
	APP_NAME,
	APP_VERSION,
	OPEN_API_VERSION,
} from "../config/constants.js";

type DocConfig = Parameters<OpenAPIHono["doc"]>[1];

// The object form rather than `DocConfig`: `app.doc` also accepts a context callback, which the
// generator API used to build the document by hand does not.
export const openApiDocument: Exclude<DocConfig, CallableFunction> = {
	openapi: OPEN_API_VERSION,
	info: {
		title: APP_NAME,
		version: APP_VERSION,
		description:
			"API for the VanLife application, including public van browsing, renter bookings and reviews, and host inventory management.",
		contact: {
			name: "VanLife API Maintainer",
			url: "https://github.com/kangcommit",
		},
		license: {
			name: "MIT",
		},
	},
};

export const scalarConfig = Scalar({
	pageTitle: "API Documentation",
	sources: [
		{
			title: "API",
			url: `${API_PREFIX}/openapi.json`,
		},
		{
			title: "Auth",
			url: `${API_PREFIX}/auth/open-api/generate-schema`,
		},
	],
});
