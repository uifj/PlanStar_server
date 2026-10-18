import { type ClientRequestOptions, hc } from "hono/client";
import type app from "./app.js";

export const createApiClient = (
	baseUrl: string,
	options?: ClientRequestOptions,
) => hc<typeof app>(baseUrl, options);

export type ApiClient = ReturnType<typeof createApiClient>;
