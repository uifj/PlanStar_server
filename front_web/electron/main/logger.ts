import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { LogLevel } from "@harness/desktop-shared";
import { cleanupExpiredLogFiles, LOG_RETENTION_DAYS } from "./logRetention";

/**
 * Main-process logger with a daily-rotated file sink.
 *
 * Modelled on ZCode's `packages/desktop/src/main/logger.ts`: one line per event with a stable
 * prefix (`[timestamp] [level] [pid:N] [source] message`), a console mirror for dev terminals,
 * and a hard rule that logging failures never propagate. A broken disk must not kill the shell.
 *
 * Renderer events arrive through the `Log` IPC channel and are stamped `source=renderer` so a
 * single file has the whole story in causal order.
 */

interface LoggerPaths {
	dir: string;
}

let paths: LoggerPaths | null = null;

/**
 * Batch sink. Every line is queued and flushed on a 250 ms timer (or immediately for warn/error)
 * so a burst of renderer logs costs one `appendFileSync` instead of one per line — the main
 * process used to block on a directory check plus a write for every single line.
 *
 * Each entry carries the day it belongs to, taken from the record's own timestamp: a batch flushed
 * just after midnight must not rewrite yesterday's history into today's file.
 */
let buffer: { date: string; line: string }[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let droppedLines = 0;

const FLUSH_DELAY_MS = 250;
const MAX_BUFFER_LINES = 500;
const MAX_LINE_BYTES = 8 * 1024;
const TRUNCATION_SUFFIX = "…[truncated]";

/**
 * The log directory is decided by the caller (main.ts) because `app.getPath('userData')` is only
 * valid after `app.whenReady()`. The `HARNESS_E2E_LOG_DIR` override lets smoke tests and CI point
 * each Electron worker at its own directory.
 */
export function initLogger(options: { logDir: string }): void {
	paths = { dir: options.logDir };
	try {
		mkdirSync(paths.dir, { recursive: true });
	} catch {
		// A missing log dir degrades to console-only; the shell keeps working.
		paths = null;
	}

	installBrokenPipeGuards();

	const cleanup = paths
		? cleanupExpiredLogFiles(paths.dir)
		: { deletedFiles: [], failedFiles: [] };
	if (cleanup.failedFiles.length > 0) {
		safeConsoleWrite(
			"warn",
			`[log-retention] failed to delete expired logs:`,
			cleanup.failedFiles,
			`retentionDays=${LOG_RETENTION_DAYS}`,
		);
	}
}

export function getLogDir(): string | null {
	return paths?.dir ?? null;
}

function installBrokenPipeGuards(): void {
	// Dev runners (`pnpm dev:electron`, wdio) can close the pipe under us; a stray EPIPE from
	// console.log would otherwise crash the main process. Guard both streams once, not per write.
	const ignore = (error: Error): void => {
		if (!isBrokenPipeError(error)) {
			throw error;
		}
	};
	process.stdout.on("error", ignore);
	process.stderr.on("error", ignore);
}

function isBrokenPipeError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "EPIPE"
	);
}

function safeConsoleWrite(level: LogLevel, ...args: unknown[]): void {
	const consoleFn =
		level === "error"
			? console.error
			: level === "warn"
				? console.warn
				: console.log;
	try {
		consoleFn(...args);
	} catch (error) {
		if (!isBrokenPipeError(error)) {
			throw error;
		}
	}
}

function formatTimestamp(date: Date): string {
	const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
		`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
	);
}

function formatDate(date: Date): string {
	const pad = (n: number): string => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function stringify(arg: unknown): string {
	if (typeof arg === "string") {
		return arg;
	}
	if (arg instanceof Error) {
		return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ""}`;
	}
	try {
		return JSON.stringify(arg);
	} catch {
		return String(arg);
	}
}

/**
 * A log record as the uploader consumes it. Deliberately the smallest shape that still answers
 * "what happened, when, and where": the console line's prefix is derived here rather than parsed
 * back out of the formatted text.
 */
export interface LogRecordEvent {
	time: string;
	level: LogLevel;
	source: string;
	message: string;
}

type LogRecordListener = (record: LogRecordEvent) => void;

const recordListeners = new Set<LogRecordListener>();

/**
 * Subscribe to every record the logger writes (or drops, once `initLogger` succeeded). Used by
 * `logUploader` to mirror the local file to the server without giving the logger a network
 * dependency. Returns an unsubscribe function.
 */
export function onLogRecord(listener: LogRecordListener): () => void {
	recordListeners.add(listener);
	return () => {
		recordListeners.delete(listener);
	};
}

/**
 * Byte-budget truncation that never emits a broken character.
 *
 * The old version cut the Buffer at a byte offset and decoded the fragment, which turns a multi-byte
 * sequence straddling the cut into U+FFFD — a replacement glyph in the middle of a sentence. Decode
 * first, then drop the trailing replacement character(s) the cut produced.
 */
function truncateUtf8(text: string, maxBytes: number): string {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) {
		return text;
	}
	const sliced = Buffer.from(text, "utf8")
		.subarray(0, Math.max(0, maxBytes))
		.toString("utf8");
	return sliced.replace(/\uFFFD+$/u, "");
}

function truncateLine(line: string): string {
	if (Buffer.byteLength(line, "utf8") <= MAX_LINE_BYTES) {
		return line;
	}
	const suffix = `${TRUNCATION_SUFFIX}\n`;
	const budget = MAX_LINE_BYTES - Buffer.byteLength(suffix, "utf8");
	return `${truncateUtf8(line, budget)}${suffix}`;
}

function scheduleFlush(): void {
	if (flushTimer) {
		return;
	}
	flushTimer = setTimeout(flushLogsSync, FLUSH_DELAY_MS);
	// Never hold the process open just to write a log line.
	flushTimer.unref();
}

/**
 * Drain the queue to disk synchronously. Called by the flush timer, right after every warn/error
 * line, and from `before-quit` — a crash or a hard quit must not lose the tail of the log.
 *
 * Entries are grouped by the day they were written on, so a flush that lands just after midnight
 * keeps yesterday's lines in yesterday's file.
 */
export function flushLogsSync(): void {
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	if (buffer.length === 0 && droppedLines === 0) {
		return;
	}
	const pending = buffer;
	buffer = [];
	if (!paths) {
		droppedLines = 0;
		return;
	}
	if (droppedLines > 0) {
		const now = new Date();
		pending.unshift({
			date: formatDate(now),
			line: `[${formatTimestamp(now)}] [warn] [pid:${process.pid}] [logger] dropped ${droppedLines} lines\n`,
		});
		droppedLines = 0;
	}

	const byDate = new Map<string, string[]>();
	for (const entry of pending) {
		const lines = byDate.get(entry.date);
		if (lines) {
			lines.push(entry.line);
		} else {
			byDate.set(entry.date, [entry.line]);
		}
	}

	try {
		for (const [date, lines] of byDate) {
			appendFileSync(join(paths.dir, `${date}.log`), lines.join(""));
		}
	} catch {
		// Never throw from a log call. A full disk or a revoked permission degrades to console-only.
	}
}

/** Fan a record out to the uploader (and any other subscriber) without letting one throw the write. */
function emitRecord(record: LogRecordEvent): void {
	for (const listener of recordListeners) {
		try {
			listener(record);
		} catch {
			// A subscriber's failure must never affect logging.
		}
	}
}

function write(level: LogLevel, source: string, args: unknown[]): void {
	const now = new Date();
	const ts = formatTimestamp(now);
	const pid = process.pid;
	const message = args.map(stringify).join(" ");
	const line = `[${ts}] [${level}] [pid:${pid}] [${source}] ${message}\n`;

	// Always mirror to console: dev terminals are the primary debug surface, and CI logs the shell
	// output for postmortems. The console mirror is cheap enough to keep unconditionally.
	safeConsoleWrite(level, `[${ts}] [pid:${pid}] [${source}]`, ...args);

	if (recordListeners.size > 0) {
		// The data file is truncated to MAX_LINE_BYTES; the uplink gets the same ceiling so a stray
		// multi-megabyte stack trace cannot blow the request budget.
		emitRecord({
			time: now.toISOString(),
			level,
			source,
			message: truncateUtf8(message, MAX_LINE_BYTES),
		});
	}

	if (!paths) {
		return;
	}

	buffer.push({ date: formatDate(now), line: truncateLine(line) });
	if (buffer.length > MAX_BUFFER_LINES) {
		const overflow = buffer.length - MAX_BUFFER_LINES;
		buffer.splice(0, overflow);
		droppedLines += overflow;
	}

	// A crash right after an error must not lose that error: warn/error flush on the spot.
	if (level === "warn" || level === "error") {
		flushLogsSync();
		return;
	}
	scheduleFlush();
}

export interface Logger {
	debug: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
	fromRenderer: (level: LogLevel, args: unknown[]) => void;
}

/**
 * The console-only fallback used before `initLogger` runs (or when the logger flag is off).
 * Same shape as the file-backed logger so callers never branch on which one is active.
 */
export const consoleLogger: Logger = {
	debug: (...args) => {
		if (process.env.NODE_ENV !== "production") {
			safeConsoleWrite("debug", "[debug] [main]", ...args);
		}
	},
	info: (...args) => safeConsoleWrite("info", "[info] [main]", ...args),
	warn: (...args) => safeConsoleWrite("warn", "[warn] [main]", ...args),
	error: (...args) => safeConsoleWrite("error", "[error] [main]", ...args),
	fromRenderer: (level, args) =>
		safeConsoleWrite(level, `[${level}] [renderer]`, ...args),
};

/**
 * The file-backed logger; only used after `initLogger` succeeds. Kept as a separate object so the
 * swap in `logger` is a single rebind rather than a mutation of the exports.
 */
const fileLogger: Logger = {
	debug: (...args) => {
		// Debug is dev-only: production logs stay small enough to attach to a bug report.
		if (process.env.NODE_ENV !== "production") {
			write("debug", "main", args);
		}
	},
	info: (...args) => write("info", "main", args),
	warn: (...args) => write("warn", "main", args),
	error: (...args) => write("error", "main", args),
	fromRenderer: (level, args) => write(level, "renderer", args),
};

/**
 * The single logger imported by every module. Methods forward to whichever implementation is
 * currently bound, so a caller can `import { logger }` at module top-level and still see file
 * output once `initLogger` runs during `app.whenReady()`.
 */
export const logger: Logger = {
	debug: (...args) => active.debug(...args),
	info: (...args) => active.info(...args),
	warn: (...args) => active.warn(...args),
	error: (...args) => active.error(...args),
	fromRenderer: (level, args) => active.fromRenderer(level, args),
};

let active: Logger = consoleLogger;

/**
 * Flip `logger` from the console fallback to the file-backed implementation. Called once by
 * `main.ts` after `initLogger`; safe to call with `consoleLogger` to force a downgrade (tests).
 */
export function bindLogger(next: Logger): void {
	active = next;
}

/** Bind the file-backed logger; no-op when `initLogger` failed to create the directory. */
export function bindFileLogger(): void {
	if (paths) {
		bindLogger(fileLogger);
	}
}
