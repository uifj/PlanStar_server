import {
	appendFile,
	mkdir,
	readdir,
	readFile,
	rmdir,
	stat,
	unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import type {
	LogDevice,
	LogDevicesResponse,
	LogQueryParams,
	LogQueryResponse,
	LogRecord,
	StoredLogRecord,
} from "./schema.js";

/**
 * Desktop log uplink storage.
 *
 * Filesystem, not the database: a crash report has to be accepted while Prisma is unavailable (a
 * crashing shell has no session, and the DB may well be the thing that took the API down), and a
 * log stream would otherwise dominate a business database's write volume. Layout:
 *
 *   <DESKTOP_LOG_ROOT>/<deviceId>/<YYYY-MM-DD>.ndjson
 *
 * One file per device per UTC day — appends are the only write, reads are a scan of at most
 * `DESKTOP_LOG_RETENTION_DAYS` files, and retention is a directory walk instead of a DELETE.
 */

/** Hard cap on a single request's decompressed body (zip-bomb guard). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.ndjson$/;

/** Thrown when a device exceeds its daily byte budget; the route maps this to 429. */
export class LogQuotaExceededError extends Error {
	constructor(message = "Daily log quota exceeded.") {
		super(message);
		this.name = "LogQuotaExceededError";
	}
}

/** Root of the log tree; `DESKTOP_LOG_ROOT` overrides `<DESKTOP_DATA_ROOT>/logs`. */
export function logRoot(): string {
	return resolve(env.DESKTOP_LOG_ROOT ?? join(env.DESKTOP_DATA_ROOT, "logs"));
}

/**
 * Per-file write queues. Appends to the same `<deviceId>/<date>` file are serialized so two uploads
 * landing together cannot interleave partial lines; different files proceed in parallel.
 */
const writeChains = new Map<string, Promise<void>>();

/** Bytes already written per `deviceId/date`, so the quota check needs no `stat` per request. */
const dailyBytes = new Map<string, number>();

function enqueue(key: string, task: () => Promise<void>): Promise<void> {
	const previous = writeChains.get(key) ?? Promise.resolve();
	const next = previous.then(task, task);
	// Keep the chain alive after a failure, but never leave an unhandled rejection behind.
	writeChains.set(
		key,
		next.catch(() => undefined),
	);
	return next;
}

/** UTC day a record belongs to: the shell's own timestamp when usable, else "now". */
export function recordDate(record: LogRecord, fallback: Date): string {
	const stamp = record.time;
	if (typeof stamp === "string") {
		const parsed = new Date(stamp);
		if (!Number.isNaN(parsed.getTime())) {
			return parsed.toISOString().slice(0, 10);
		}
	}
	if (typeof stamp === "number") {
		const parsed = new Date(stamp);
		if (!Number.isNaN(parsed.getTime())) {
			return parsed.toISOString().slice(0, 10);
		}
	}
	return fallback.toISOString().slice(0, 10);
}

async function fileSize(path: string): Promise<number> {
	try {
		return (await stat(path)).size;
	} catch {
		return 0;
	}
}

/** Drop cached counters for days that can no longer be written to (keeps the map bounded). */
function pruneCounters(today: string): void {
	for (const key of dailyBytes.keys()) {
		if (key.slice(key.lastIndexOf("/") + 1) !== today) {
			dailyBytes.delete(key);
		}
	}
}

async function appendGroup(
	deviceId: string,
	date: string,
	payload: string,
): Promise<void> {
	const dir = join(logRoot(), deviceId);
	const path = join(dir, `${date}.ndjson`);
	const key = `${deviceId}/${date}`;
	const size = Buffer.byteLength(payload, "utf8");
	const current = dailyBytes.get(key) ?? (await fileSize(path));
	const quota = env.DESKTOP_LOG_DAILY_QUOTA_BYTES;
	if (current + size > quota) {
		// Remember what is on disk so a smaller batch can still fit next time.
		dailyBytes.set(key, current);
		throw new LogQuotaExceededError(
			`Daily log quota exceeded for device ${deviceId} (${current + size} > ${quota} bytes on ${date}).`,
		);
	}
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await appendFile(path, payload, { mode: 0o600 });
	dailyBytes.set(key, current + size);
}

export interface AppendResult {
	appended: number;
	dropped: number;
}

/**
 * Append a batch, grouping records by the UTC day each one belongs to. A record that would push a
 * device past its daily quota is rejected with `LogQuotaExceededError` rather than silently dropped,
 * so the shell can spool it and retry after the day rolls over.
 */
export async function appendBatch(
	deviceId: string,
	records: LogRecord[],
	now = new Date(),
): Promise<AppendResult> {
	const groups = new Map<string, string[]>();
	for (const record of records) {
		const date = recordDate(record, now);
		const line = `${JSON.stringify(record)}\n`;
		const lines = groups.get(date);
		if (lines) {
			lines.push(line);
		} else {
			groups.set(date, [line]);
		}
	}

	pruneCounters(now.toISOString().slice(0, 10));

	await Promise.all(
		[...groups.entries()].map(([date, lines]) =>
			enqueue(`${deviceId}/${date}`, () =>
				appendGroup(deviceId, date, lines.join("")),
			),
		),
	);

	return { appended: records.length, dropped: 0 };
}

function isDateName(name: string): string | null {
	const match = DATE_FILE.exec(name);
	return match ? match[1] : null;
}

async function listDeviceIds(): Promise<string[]> {
	try {
		const entries = await readdir(logRoot(), { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

async function listDates(deviceId: string): Promise<string[]> {
	try {
		const entries = await readdir(join(logRoot(), deviceId));
		return entries
			.map(isDateName)
			.filter((date): date is string => date !== null)
			.sort();
	} catch {
		return [];
	}
}

function parseLine(
	line: string,
	deviceId: string,
	date: string,
): StoredLogRecord | null {
	if (line.trim() === "") {
		return null;
	}
	try {
		const parsed = JSON.parse(line) as Record<string, unknown>;
		if (typeof parsed !== "object" || parsed === null) {
			return null;
		}
		return { ...parsed, deviceId, date } as StoredLogRecord;
	} catch {
		// A torn last line (process killed mid-write) is expected; skip it instead of failing the read.
		return null;
	}
}

/**
 * Read back logs, newest last. `q` is a case-insensitive substring check against the serialized
 * record — grep, not a query language; the operator has the raw NDJSON on disk for anything more.
 */
export async function queryLogs(
	params: LogQueryParams,
): Promise<LogQueryResponse> {
	const devices = params.deviceId ? [params.deviceId] : await listDeviceIds();
	const records: StoredLogRecord[] = [];
	const needles = params.q ? params.q.toLowerCase() : null;

	for (const deviceId of devices) {
		const dates = params.date ? [params.date] : await listDates(deviceId);
		for (const date of dates) {
			let text: string;
			try {
				text = await readFile(
					join(logRoot(), deviceId, `${date}.ndjson`),
					"utf8",
				);
			} catch {
				continue;
			}
			for (const line of text.split("\n")) {
				if (needles && !line.toLowerCase().includes(needles)) {
					continue;
				}
				const record = parseLine(line, deviceId, date);
				if (record) {
					records.push(record);
				}
			}
		}
	}

	records.sort((a, b) =>
		String(a.time ?? "").localeCompare(String(b.time ?? "")),
	);
	const matched = records.length;
	const limited = records.slice(Math.max(0, matched - params.limit));
	return { records: limited, matched, truncated: matched > limited.length };
}

/** Device inventory for the operator: how much each device is holding and over which days. */
export async function listDevices(): Promise<LogDevicesResponse> {
	const devices: LogDevice[] = [];
	for (const deviceId of await listDeviceIds()) {
		const dates = await listDates(deviceId);
		if (dates.length === 0) {
			continue;
		}
		let bytes = 0;
		for (const date of dates) {
			bytes += await fileSize(join(logRoot(), deviceId, `${date}.ndjson`));
		}
		devices.push({
			deviceId,
			days: dates.length,
			bytes,
			firstDate: dates[0] ?? null,
			lastDate: dates[dates.length - 1] ?? null,
		});
	}
	return { devices };
}

export interface SweepResult {
	deletedFiles: string[];
	failedFiles: string[];
}

/**
 * Delete day-files older than `DESKTOP_LOG_RETENTION_DAYS` (UTC) and drop the device directory once
 * it empties. Called once at boot and every 6 h, so retention never needs cron in the container.
 */
export async function sweepExpired(now = new Date()): Promise<SweepResult> {
	const days = env.DESKTOP_LOG_RETENTION_DAYS;
	const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10);

	const result: SweepResult = { deletedFiles: [], failedFiles: [] };
	for (const deviceId of await listDeviceIds()) {
		const dir = join(logRoot(), deviceId);
		const dates = await listDates(deviceId);
		let removed = 0;
		for (const date of dates) {
			if (date >= cutoff) {
				continue;
			}
			try {
				await unlink(join(dir, `${date}.ndjson`));
				dailyBytes.delete(`${deviceId}/${date}`);
				result.deletedFiles.push(`${deviceId}/${date}.ndjson`);
				removed += 1;
			} catch {
				result.failedFiles.push(`${deviceId}/${date}.ndjson`);
			}
		}
		if (removed === dates.length) {
			try {
				// Only succeeds when empty: never removes a device that still has live days.
				await rmdir(dir);
			} catch {
				// Non-empty or already gone: both fine.
			}
		}
	}

	if (result.deletedFiles.length > 0) {
		logger.info(
			{ deleted: result.deletedFiles.length, retentionDays: days },
			"desktop log retention sweep",
		);
	}
	return result;
}

/** Test/ops helper: the absolute path of one device's day-file. */
export function logFilePath(deviceId: string, date: string): string {
	return join(logRoot(), deviceId, `${date}.ndjson`);
}
