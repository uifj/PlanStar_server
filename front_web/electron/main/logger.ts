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
let initialized = false;

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
	initialized = true;

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

export function isLoggerInitialized(): boolean {
	return initialized;
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

function write(level: LogLevel, source: string, args: unknown[]): void {
	const now = new Date();
	const ts = formatTimestamp(now);
	const pid = process.pid;
	const message = args.map(stringify).join(" ");
	const line = `[${ts}] [${level}] [pid:${pid}] [${source}] ${message}\n`;

	// Always mirror to console: dev terminals are the primary debug surface, and CI logs the shell
	// output for postmortems. The console mirror is cheap enough to keep unconditionally.
	safeConsoleWrite(level, `[${ts}] [pid:${pid}] [${source}]`, ...args);

	if (!paths) {
		return;
	}

	const filePath = join(paths.dir, `${formatDate(now)}.log`);
	try {
		mkdirSync(paths.dir, { recursive: true });
		appendFileSync(filePath, line);
	} catch {
		// Never throw from a log call. A full disk or a revoked permission degrades to console-only.
	}
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
