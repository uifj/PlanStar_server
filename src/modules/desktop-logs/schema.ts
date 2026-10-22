import z from "zod";

/**
 * Wire shapes for the desktop log uplink.
 *
 * The shell uploads what its logger already writes: one JSON object per line (NDJSON), optionally
 * gzipped. Records are intentionally loose — a newer shell may add fields (pid, requestId, stack),
 * and an older server must keep accepting them rather than 400 the whole batch.
 */

/**
 * Device id constraint. It doubles as the directory name on disk, so the alphabet is restricted to
 * characters that cannot traverse (`..`, `/`) and the length keeps a single directory name bounded.
 */
export const DeviceIdSchema = z
	.string()
	.regex(
		/^[A-Za-z0-9_-]{8,64}$/,
		"deviceId must be 8-64 chars of [A-Za-z0-9_-]",
	);

export const LogRecordSchema = z.looseObject({
	/** ISO timestamp taken by the shell when the line was written. */
	time: z.string().max(64).optional(),
	level: z.string().max(16).optional(),
	source: z.string().max(64).optional(),
	message: z
		.string()
		.max(64 * 1024)
		.optional(),
});

export type LogRecord = z.infer<typeof LogRecordSchema>;

/** A record as it is served back: the stored line plus the file it came from. */
export const StoredLogRecordSchema = z.looseObject({
	deviceId: DeviceIdSchema,
	date: z.string(),
	time: z.string().max(64).optional(),
	level: z.string().max(16).optional(),
	source: z.string().max(64).optional(),
	message: z
		.string()
		.max(64 * 1024)
		.optional(),
});

export type StoredLogRecord = z.infer<typeof StoredLogRecordSchema>;

/**
 * Ingest selectors. `deviceId` is required because it is the storage key: an anonymous write still
 * has to land in exactly one directory, and a server-assigned id would make the shell unable to
 * correlate its spool with what arrived.
 */
export const LogIngestQuerySchema = z.object({
	deviceId: DeviceIdSchema,
	appVersion: z.string().max(64).optional(),
	platform: z.string().max(64).optional(),
});

export type LogIngestQuery = z.infer<typeof LogIngestQuerySchema>;

export const LogIngestAcceptedSchema = z.object({
	received: z.literal(true),
	appended: z.number().int().nonnegative(),
	/** Records dropped by the per-device daily quota (accepted, not written). */
	dropped: z.number().int().nonnegative(),
});

export type LogIngestAccepted = z.infer<typeof LogIngestAcceptedSchema>;

export const LogQueryParamsSchema = z.object({
	deviceId: DeviceIdSchema.optional(),
	/** UTC day, `YYYY-MM-DD`. Omitted means "every retained day". */
	date: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
		.optional(),
	/** Case-insensitive substring filter applied to the serialized record. */
	q: z.string().max(200).optional(),
	limit: z.coerce.number().int().min(1).max(2000).default(500),
});

export type LogQueryParams = z.infer<typeof LogQueryParamsSchema>;

export const LogQueryResponseSchema = z.object({
	records: z.array(StoredLogRecordSchema),
	/** Number of records that matched before `limit` was applied. */
	matched: z.number().int().nonnegative(),
	truncated: z.boolean(),
});

export type LogQueryResponse = z.infer<typeof LogQueryResponseSchema>;

export const LogDeviceSchema = z.object({
	deviceId: DeviceIdSchema,
	days: z.number().int().nonnegative(),
	bytes: z.number().int().nonnegative(),
	firstDate: z.string().nullable(),
	lastDate: z.string().nullable(),
});

export type LogDevice = z.infer<typeof LogDeviceSchema>;

export const LogDevicesResponseSchema = z.object({
	devices: z.array(LogDeviceSchema),
});

export type LogDevicesResponse = z.infer<typeof LogDevicesResponseSchema>;
