import { createHash, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { env } from "../../config/env.js";
import {
	BadRequestError,
	NotFoundError,
	UnauthorizedError,
} from "../../errors/http-errors.js";
import { logger } from "../../lib/logger.js";
import {
	appendLogsRoute,
	listLogDevicesRoute,
	queryLogsRoute,
} from "./routes.js";
import { type LogRecord, LogRecordSchema } from "./schema.js";
import * as service from "./service.js";

/**
 * Desktop log uplink router, mounted under `/api/desktop`.
 *
 * Two postures in one module:
 *   - POST is anonymous. A packaged app cannot hold a secret, and a shell that just crashed must be
 *     able to report before it has any session. Abuse is bounded by the device-id shape, the 4 MiB
 *     decompressed cap and the per-device daily quota.
 *   - GET is operator-only. When `DESKTOP_LOG_READ_TOKEN` is unset the whole read surface answers
 *     404, so a deployment that never configured it does not expose other users' logs.
 */
export const desktopLogsRouter = new OpenAPIHono();

const GZIP_MAGIC = [0x1f, 0x8b];

function isGzip(buffer: Uint8Array): boolean {
	return buffer[0] === GZIP_MAGIC[0] && buffer[1] === GZIP_MAGIC[1];
}

/** Constant-time bearer check; hashing first keeps the comparison length-independent. */
function assertReadAccess(c: Context): void {
	const expected = env.DESKTOP_LOG_READ_TOKEN;
	if (!expected) {
		throw new NotFoundError("Log querying is not enabled on this deployment.");
	}
	const header = c.req.header("Authorization") ?? "";
	const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
	const a = createHash("sha256").update(provided).digest();
	const b = createHash("sha256").update(expected).digest();
	if (!timingSafeEqual(a, b)) {
		throw new UnauthorizedError("Invalid log read token.");
	}
}

/**
 * Decode the upload body. The shell gzips (logs compress ~10x), but a plain NDJSON body is accepted
 * too — the e2e and smoke scripts post either, and a proxy that strips `Content-Encoding` should not
 * turn a working upload into a 400.
 */
function decodeBody(raw: Uint8Array): string {
	if (raw.byteLength > service.MAX_UPLOAD_BYTES) {
		throw new BadRequestError(
			`Log batch exceeds ${service.MAX_UPLOAD_BYTES} bytes.`,
		);
	}
	if (!isGzip(raw)) {
		return Buffer.from(raw).toString("utf8");
	}
	try {
		// maxOutputLength turns a compression bomb into an error instead of an OOM.
		return gunzipSync(raw, {
			maxOutputLength: service.MAX_UPLOAD_BYTES,
		}).toString("utf8");
	} catch {
		throw new BadRequestError(
			`Log batch is not valid gzip or exceeds ${service.MAX_UPLOAD_BYTES} bytes decompressed.`,
		);
	}
}

/** Parse NDJSON, tolerating (and counting) lines a newer shell wrote in a shape we cannot read. */
export function parseNdjson(text: string): {
	records: LogRecord[];
	invalid: number;
} {
	const records: LogRecord[] = [];
	let invalid = 0;
	for (const line of text.split("\n")) {
		if (line.trim() === "") {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			invalid += 1;
			continue;
		}
		const result = LogRecordSchema.safeParse(parsed);
		if (result.success) {
			records.push(result.data);
		} else {
			invalid += 1;
		}
	}
	return { records, invalid };
}

desktopLogsRouter.openapi(appendLogsRoute, async (c) => {
	const { deviceId } = c.req.valid("query");
	const { records, invalid } = parseNdjson(
		decodeBody(new Uint8Array(await c.req.arrayBuffer())),
	);

	if (records.length === 0) {
		throw new BadRequestError(
			invalid > 0
				? "No record could be parsed from the batch."
				: "The batch contained no records.",
		);
	}

	try {
		const result = await service.appendBatch(deviceId, records);
		return c.json({ received: true as const, ...result }, 202);
	} catch (error) {
		if (error instanceof service.LogQuotaExceededError) {
			logger.warn({ deviceId }, "desktop log upload rejected: daily quota");
			return c.json({ message: error.message }, 429, { "Retry-After": "60" });
		}
		throw error;
	}
});

desktopLogsRouter.openapi(queryLogsRoute, async (c) => {
	assertReadAccess(c);
	return c.json(await service.queryLogs(c.req.valid("query")), 200);
});

desktopLogsRouter.openapi(listLogDevicesRoute, async (c) => {
	assertReadAccess(c);
	return c.json(await service.listDevices(), 200);
});
