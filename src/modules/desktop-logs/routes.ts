import { createRoute } from "@hono/zod-openapi";
import z from "zod";
import {
	errorResponse,
	forbiddenResponse,
	notFoundResponse,
	okResponse,
	response,
} from "../../openapi/responses.js";
import { OPENAPI_TAGS } from "../../openapi/tags.js";
import {
	LogDevicesResponseSchema,
	LogIngestAcceptedSchema,
	LogIngestQuerySchema,
	LogQueryParamsSchema,
	LogQueryResponseSchema,
} from "./schema.js";

const tags = [OPENAPI_TAGS.DESKTOP];

/**
 * Log uplink + operator read surface.
 *
 * Write is anonymous by design: a packaged Electron app cannot be handed a runtime secret — anything
 * embedded in the bundle is extractable — so a static token would add operational cost with zero
 * security gain. The abuse surface is bounded instead by the device-id shape, the per-device daily
 * quota and the 4 MiB decompressed-body cap. Reads carry the real secret.
 */

export const appendLogsRoute = createRoute({
	method: "post",
	path: "/logs",
	tags,
	summary: "Upload a desktop log batch",
	description:
		"Accepts an NDJSON batch (optionally gzip-compressed) from the shell's log uploader. Records " +
		"are appended to `<DESKTOP_LOG_ROOT>/<deviceId>/<UTC day>.ndjson`; the day comes from each " +
		"record's own timestamp, so a spooled batch replayed after midnight still lands on the day it " +
		"was written. Anonymous: a crashing or signed-out shell must still be able to report. Rejected " +
		"with 429 once a device exceeds DESKTOP_LOG_DAILY_QUOTA_BYTES for that day.",
	request: {
		query: LogIngestQuerySchema,
		body: {
			required: true,
			content: {
				"application/x-ndjson": { schema: z.string() },
				"application/gzip": { schema: z.any() },
			},
		},
	},
	responses: {
		202: response("Batch accepted.", LogIngestAcceptedSchema),
		400: errorResponse("The batch body was missing or not valid NDJSON."),
		429: errorResponse("Daily log quota exceeded for this device."),
	},
});

export const queryLogsRoute = createRoute({
	method: "get",
	path: "/logs",
	tags,
	summary: "Query uploaded desktop logs",
	description:
		"Operator read endpoint. Requires `Authorization: Bearer <DESKTOP_LOG_READ_TOKEN>`; when the " +
		"token is unset the endpoint answers 404 so the surface is closed rather than exposed. `q` is " +
		"a case-insensitive substring filter over the serialized record (grep, not a query language) " +
		"and `limit` keeps the newest matching lines.",
	request: { query: LogQueryParamsSchema },
	responses: {
		...okResponse("Matching log records, newest last.", LogQueryResponseSchema),
		...forbiddenResponse,
		...notFoundResponse("Log querying is not enabled on this deployment."),
	},
});

export const listLogDevicesRoute = createRoute({
	method: "get",
	path: "/logs/devices",
	tags,
	summary: "List devices that uploaded logs",
	description:
		"Operator inventory: one row per device directory with the retained day count, total bytes and " +
		"the first/last day present. Same bearer token as `GET /logs`, same 404-when-unconfigured rule.",
	responses: {
		...okResponse("Device inventory.", LogDevicesResponseSchema),
		...forbiddenResponse,
		...notFoundResponse("Log querying is not enabled on this deployment."),
	},
});
