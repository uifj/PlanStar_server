import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { app } from "electron";
import { apiUrl } from "./desktop";
import { getOrCreateDeviceId } from "./deviceId";
import { consoleLogger, type LogRecordEvent, onLogRecord } from "./logger";

/**
 * Log uplink.
 *
 * Mirrors what the main-process logger writes to the harness backend so a support engineer can read
 * a user's log without asking for a zip. Design constraints, all of which came from running this
 * against a real crash:
 *
 *   - The uplink must never block or crash the shell: every failure path degrades to a local spool
 *     file and a later retry, and `dispose()` flushes synchronously on the way out.
 *   - One request must stay small (200 records / 256 KiB): a crash loop produces a burst, and the
 *     server has a 4 MiB decompressed cap plus a per-device daily quota.
 *   - Offline has to be a first-class state. A laptop that boots on a plane must not lose its boot
 *     logs, so batches land in `userData/logs/pending/*.ndjson.gz` and are drained oldest-first on
 *     the next successful run.
 */

export const DEFAULT_BATCH_SIZE = 200;
export const DEFAULT_BATCH_BYTES = 256 * 1024;
export const DEFAULT_FLUSH_INTERVAL_MS = 30_000;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_BACKOFF_MS: readonly number[] = [
	2_000, 10_000, 60_000, 300_000,
];
export const MAX_SPOOL_FILES = 200;
export const MAX_SPOOL_BYTES = 50 * 1024 * 1024;

export type SendOutcome = "ok" | "retry" | "drop";

export interface LogUploaderOptions {
	/** API origin; defaults to the shell's configured backend. */
	apiBaseUrl?: () => string;
	/** Device id supplier; defaults to the persisted id in `userData`. */
	deviceId?: () => string;
	/** Spool directory; defaults to `userData/logs/pending`. */
	spoolDir?: () => string;
	appVersion?: () => string;
	platform?: () => string;
	batchSize?: number;
	batchBytes?: number;
	flushIntervalMs?: number;
	timeoutMs?: number;
	backoffMs?: readonly number[];
	fetchImpl?: typeof fetch;
}

export interface LogUploader {
	/**
	 * Send everything queued (and drain the spool). Safe to call concurrently. Resolves `true` when
	 * the queue drained to the server, `false` when it had to be spooled instead.
	 */
	flush(): Promise<boolean>;
	/** Unsubscribe, flush once, and spool whatever is left. Idempotent. */
	dispose(): Promise<void>;
	/** Records waiting to be sent (test/telemetry hook). */
	pending(): number;
	/** Number of spool files on disk (test/ops hook). */
	spooled(): number;
}

function defaultSpoolDir(): string {
	return join(app.getPath("userData"), "logs", "pending");
}

export function initLogUploader(options: LogUploaderOptions = {}): LogUploader {
	const apiBaseUrl = options.apiBaseUrl ?? apiUrl;
	const spoolDir = options.spoolDir ?? defaultSpoolDir;
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
	const batchBytes = options.batchBytes ?? DEFAULT_BATCH_BYTES;
	const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const appVersion = options.appVersion ?? (() => app.getVersion());
	const platform =
		options.platform ?? (() => `${process.platform}-${process.arch}`);
	// Resolved lazily: the device id file lives in userData, which exists before this runs, but a
	// failing read must not take the uploader (and therefore the app) down at startup.
	const deviceId =
		options.deviceId ??
		(() => {
			try {
				return getOrCreateDeviceId();
			} catch {
				return "unidentified-device";
			}
		});

	let queue: LogRecordEvent[] = [];
	let queuedBytes = 0;
	let inFlight = false;
	let disposed = false;
	let backoffIndex = 0;
	let interval: NodeJS.Timeout | null = null;
	let retryTimer: NodeJS.Timeout | null = null;

	const endpoint = (): string =>
		`${apiBaseUrl()}/api/desktop/logs?deviceId=${encodeURIComponent(deviceId())}&appVersion=${encodeURIComponent(appVersion())}&platform=${encodeURIComponent(platform())}`;

	function ensureSpoolDir(): boolean {
		try {
			mkdirSync(spoolDir(), { recursive: true, mode: 0o700 });
			return true;
		} catch {
			return false;
		}
	}

	function spoolFiles(): { path: string; size: number }[] {
		try {
			return readdirSync(spoolDir())
				.filter((name) => name.endsWith(".ndjson.gz"))
				.sort()
				.map((name) => {
					const path = join(spoolDir(), name);
					try {
						return { path, size: statSync(path).size };
					} catch {
						return { path, size: 0 };
					}
				});
		} catch {
			return [];
		}
	}

	/** Keep the spool bounded: oldest files go first, because the newest ones describe the incident. */
	function pruneSpool(): void {
		const files = spoolFiles();
		let total = files.reduce((sum, file) => sum + file.size, 0);
		while (
			files.length > 0 &&
			(files.length > MAX_SPOOL_FILES || total > MAX_SPOOL_BYTES)
		) {
			const oldest = files.shift();
			if (!oldest) {
				break;
			}
			total -= oldest.size;
			try {
				unlinkSync(oldest.path);
			} catch {
				// Another writer may have drained it; nothing to do.
			}
		}
	}

	function spoolWrite(records: LogRecordEvent[]): void {
		if (records.length === 0 || !ensureSpoolDir()) {
			return;
		}
		const body = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
		// Timestamp prefix keeps the directory sortable oldest-first.
		const name = `${String(Date.now()).padStart(14, "0")}-${randomUUID()}.ndjson.gz`;
		try {
			writeFileSync(join(spoolDir(), name), gzipSync(Buffer.from(body)), {
				mode: 0o600,
			});
		} catch {
			return;
		}
		pruneSpool();
	}

	async function post(body: Uint8Array): Promise<SendOutcome> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetchImpl(endpoint(), {
				method: "POST",
				headers: {
					"Content-Type": "application/x-ndjson",
					"Content-Encoding": "gzip",
				},
				body: body as unknown as BodyInit,
				signal: controller.signal,
			});
			if (response.ok) {
				return "ok";
			}
			// 429 (quota) and 5xx are transient; 400/413 mean this batch will never be accepted, so
			// dropping it is the only way to avoid an infinite retry loop.
			if (response.status === 400 || response.status === 413) {
				// Deliberately not `logger.warn`: that would emit a record back into this very queue and,
				// with a full batch threshold, turn a rejected batch into an infinite send loop.
				consoleLogger.warn("[log-upload] batch rejected:", response.status);
				return "drop";
			}
			return "retry";
		} catch {
			return "retry";
		} finally {
			clearTimeout(timeout);
		}
	}

	function scheduleRetry(): void {
		if (disposed || retryTimer) {
			return;
		}
		const delay = backoffMs[Math.min(backoffIndex, backoffMs.length - 1)];
		backoffIndex += 1;
		retryTimer = setTimeout(() => {
			retryTimer = null;
			void flush();
		}, delay);
		retryTimer.unref();
	}

	async function drainSpool(): Promise<boolean> {
		for (const file of spoolFiles()) {
			let body: Uint8Array;
			try {
				body = new Uint8Array(readFileSync(file.path));
			} catch {
				continue;
			}
			const outcome = await post(body);
			if (outcome === "ok" || outcome === "drop") {
				try {
					unlinkSync(file.path);
				} catch {
					// Already gone.
				}
				continue;
			}
			// Still offline: stop here so the spool keeps its order.
			scheduleRetry();
			return false;
		}
		return true;
	}

	function takeBatch(): LogRecordEvent[] {
		const batch: LogRecordEvent[] = [];
		let bytes = 0;
		while (queue.length > 0 && batch.length < batchSize) {
			const next = queue[0];
			if (!next) {
				break;
			}
			const size = Buffer.byteLength(JSON.stringify(next), "utf8") + 1;
			if (batch.length > 0 && bytes + size > batchBytes) {
				break;
			}
			batch.push(next);
			queue.shift();
			bytes += size;
		}
		queuedBytes = Math.max(0, queuedBytes - bytes);
		return batch;
	}

	/** Everything still queued, removed from memory. Used when the uplink turns out to be offline. */
	function drainQueue(): LogRecordEvent[] {
		const rest = queue;
		queue = [];
		queuedBytes = 0;
		return rest;
	}

	async function flush(): Promise<boolean> {
		if (inFlight) {
			return queue.length === 0;
		}
		inFlight = true;
		let delivered = true;
		try {
			if (!(await drainSpool())) {
				// Offline. Move memory to disk now instead of holding a growing queue until quit — an
				// offline laptop may run for days.
				spoolWrite(drainQueue());
				return false;
			}
			while (queue.length > 0) {
				const batch = takeBatch();
				const body = gzipSync(
					Buffer.from(
						`${batch.map((record) => JSON.stringify(record)).join("\n")}\n`,
					),
				);
				const outcome = await post(new Uint8Array(body));
				if (outcome === "ok") {
					backoffIndex = 0;
					continue;
				}
				if (outcome === "drop") {
					continue;
				}
				spoolWrite([...batch, ...drainQueue()]);
				scheduleRetry();
				delivered = false;
				break;
			}
		} finally {
			inFlight = false;
		}
		return delivered && queue.length === 0;
	}

	const off = onLogRecord((record) => {
		if (disposed) {
			return;
		}
		queue.push(record);
		queuedBytes += Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
		if (queue.length >= batchSize || queuedBytes >= batchBytes) {
			void flush();
		}
	});

	interval = setInterval(() => {
		void flush();
	}, flushIntervalMs);
	interval.unref();

	return {
		flush,
		pending: () => queue.length,
		spooled: () => spoolFiles().length,
		dispose: async () => {
			if (disposed) {
				return;
			}
			disposed = true;
			off();
			if (interval) {
				clearInterval(interval);
				interval = null;
			}
			if (retryTimer) {
				clearTimeout(retryTimer);
				retryTimer = null;
			}
			// Best effort: quit must not wait on a network round trip, so anything still queued is
			// written to the spool synchronously and replayed on the next launch.
			try {
				await flush();
			} catch {
				// Never let the uplink break a quit.
			}
			const leftover = queue;
			queue = [];
			queuedBytes = 0;
			spoolWrite(leftover);
		},
	};
}
