import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import type { ExportLogsResult } from "@harness/desktop-shared";
import { app, shell } from "electron";
import { logger } from "./logger";
import { createZipBuffer, type ZipEntryInput } from "./zip";

/**
 * Log export.
 *
 * Collects `<userData>/logs/*.log`, `window.json`, and an `about.json` snapshot into a single
 * zip under `<userData>/exports/`, then reveals it in the system file manager so the user can
 * attach it to a bug report.
 *
 * Simplified from ZCode's 1246-line `exportLogs.ts`: we drop CUA helper dirs, docshot assets,
 * repo snapshots and dev-only sub-trees that don't exist in this product. The redaction pass is
 * kept — the moment a log line contains a token or a password is the moment this feature becomes
 * a leak, and the whole point of the whitelist/blacklist is to fail closed on unknown shapes.
 */

const EXPORT_DIR_NAME = "exports";
const LOG_DIR_NAME = "logs";
const MAX_LOG_FILES = 5;
const REDACTED_PLACEHOLDER = "***REDACTED***";

/** Substrings that mark a JSON/log key as sensitive. Loose on purpose — see whitelist below. */
const SENSITIVE_KEY_SUBSTRINGS = [
	"password",
	"passwd",
	"pwd",
	"secret",
	"token",
	"auth",
	"credential",
	"cookie",
	"session",
	"apikey",
	"api_key",
	"private_key",
	"privatekey",
] as const;

/**
 * Keys that contain a sensitive substring but are provably safe. Any hit here short-circuits the
 * redaction so `input_tokens`, `author`, etc. survive intact.
 */
const SENSITIVE_KEY_WHITELIST = [
	"input_tokens",
	"output_tokens",
	"total_tokens",
	"token_count",
	"tokencount",
	"author",
	"authors",
	"authority",
	"authorize_url",
	"sessionstorage",
	"session_id_field",
] as const;

/** Files whose contents are always sensitive regardless of key names. Never enter the archive. */
const SENSITIVE_FILE_NAMES = new Set([
	"credentials.json",
	".credentials.json",
	"cookies",
	"cookies-journal",
	"login data",
	"login data-journal",
	"web data",
	"web data-journal",
]);

/** Bearer / Basic tokens embedded in free-form log lines. */
const INLINE_TOKEN_PATTERNS: readonly RegExp[] = [
	/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
	/\bBasic\s+[A-Za-z0-9+/=]{8,}/gi,
	/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, // JWT
];

/**
 * `key=value` and `"key":"value"` shapes with a sensitive key. Matches both JSON and logfmt so a
 * single pass covers the two formats the shell produces.
 */
const KEY_VALUE_RE =
	/(["']?)([A-Za-z0-9_.-]+)\1\s*[:=]\s*(["']?)([^"'\s,}\]]+)\3/g;

function isSensitiveKey(key: string): boolean {
	const lowered = key.toLowerCase();
	if (
		SENSITIVE_KEY_WHITELIST.some(
			(safe) => lowered === safe || lowered.endsWith(`_${safe}`),
		)
	) {
		return false;
	}
	return SENSITIVE_KEY_SUBSTRINGS.some((needle) => lowered.includes(needle));
}

export function redactText(input: string): string {
	let output = input;

	// 1. Inline tokens (Bearer / Basic / JWT) get redacted first — they may span a value the
	//    key/value regex would not match cleanly.
	for (const pattern of INLINE_TOKEN_PATTERNS) {
		output = output.replace(pattern, REDACTED_PLACEHOLDER);
	}

	// 2. key=value and "key":"value" redaction.
	output = output.replace(KEY_VALUE_RE, (match, q1, key, q2, value) => {
		if (!isSensitiveKey(key)) {
			return match;
		}
		return `${q1}${key}${q1}${match.includes("=") ? "=" : ":"}${q2}${REDACTED_PLACEHOLDER}${q2}`;
	});

	return output;
}

function isSensitiveFileName(fileName: string): boolean {
	return SENSITIVE_FILE_NAMES.has(fileName.toLowerCase());
}

interface CollectOptions {
	userDataDir: string;
	now: Date;
	maxLogFiles?: number;
}

interface CollectedFile {
	archivePath: string;
	data: Buffer;
}

function listLogFiles(logDir: string, maxFiles: number): string[] {
	if (!existsSync(logDir)) {
		return [];
	}
	try {
		const entries = readdirSync(logDir, { withFileTypes: true })
			.filter((e) => e.isFile() && e.name.endsWith(".log"))
			.map((e) => ({ name: e.name, path: join(logDir, e.name) }))
			.map((entry) => ({ ...entry, mtime: statSync(entry.path).mtimeMs }))
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, maxFiles);
		return entries.map((e) => e.path);
	} catch (error) {
		logger.warn("[export-logs] failed to list log dir:", error);
		return [];
	}
}

function collectFiles(options: CollectOptions): CollectedFile[] {
	const { userDataDir, now } = options;
	const maxLogFiles = options.maxLogFiles ?? MAX_LOG_FILES;
	const collected: CollectedFile[] = [];

	const logDir = join(userDataDir, LOG_DIR_NAME);
	for (const filePath of listLogFiles(logDir, maxLogFiles)) {
		try {
			const raw = readFileSync(filePath, "utf8");
			const redacted = redactText(raw);
			const archivePath = `${LOG_DIR_NAME}/${filePath.split(sep).pop()}`;
			collected.push({ archivePath, data: Buffer.from(redacted, "utf8") });
		} catch (error) {
			logger.warn("[export-logs] failed to read log file:", filePath, error);
		}
	}

	const windowStatePath = join(userDataDir, "window.json");
	if (existsSync(windowStatePath) && !isSensitiveFileName("window.json")) {
		try {
			const raw = readFileSync(windowStatePath, "utf8");
			collected.push({
				archivePath: "window.json",
				data: Buffer.from(redactText(raw), "utf8"),
			});
		} catch (error) {
			logger.warn("[export-logs] failed to read window.json:", error);
		}
	}

	const about = buildAboutSnapshot(now);
	collected.push({
		archivePath: "about.json",
		data: Buffer.from(JSON.stringify(about, null, 2), "utf8"),
	});

	return collected;
}

export function buildAboutSnapshot(now: Date): Record<string, unknown> {
	return {
		product: app.name,
		version: app.getVersion(),
		packaged: app.isPackaged,
		electron: process.versions.electron,
		chrome: process.versions.chrome,
		node: process.versions.node,
		v8: process.versions.v8,
		platform: process.platform,
		arch: process.arch,
		locale: app.getLocale(),
		uptimeSeconds: Math.round(process.uptime()),
		generatedAt: now.toISOString(),
	};
}

function formatArchiveTimestamp(now: Date): string {
	const pad = (n: number): string => String(n).padStart(2, "0");
	return (
		`${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
		`-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
	);
}

export interface ExportLogsOptions {
	userDataDir?: string;
	now?: Date;
	/** Skip the reveal-in-Finder step (used by tests and CLI callers). */
	reveal?: boolean;
	maxLogFiles?: number;
}

export async function exportLogs(
	options: ExportLogsOptions = {},
): Promise<ExportLogsResult> {
	const now = options.now ?? new Date();
	const userDataDir = options.userDataDir ?? app.getPath("userData");
	const reveal = options.reveal ?? true;

	try {
		const collected = collectFiles({
			userDataDir,
			now,
			maxLogFiles: options.maxLogFiles,
		});
		if (collected.length === 0) {
			return { success: false, error: "no-logs" };
		}

		const entries: ZipEntryInput[] = collected.map((file) => ({
			archivePath: file.archivePath,
			data: file.data,
			mtime: now,
		}));
		const zip = createZipBuffer(entries);

		const exportDir = join(userDataDir, EXPORT_DIR_NAME);
		mkdirSync(exportDir, { recursive: true });
		const zipPath = join(
			exportDir,
			`anytype-harness-logs-${formatArchiveTimestamp(now)}.zip`,
		);
		writeFileSync(zipPath, zip);

		logger.info("[export-logs] wrote", zipPath, `(${zip.byteLength} bytes)`);

		if (reveal) {
			try {
				shell.showItemInFolder(zipPath);
			} catch (error) {
				// Revealing is best-effort: the file is already on disk, the user can find it.
				logger.warn("[export-logs] failed to reveal in folder:", error);
			}
		}

		return { success: true, path: zipPath };
	} catch (error) {
		logger.error("[export-logs] failed:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Re-exported for tests that want to verify archive layout without touching the shell. */
export const __test__ = {
	collectFiles,
	isSensitiveKey,
	isSensitiveFileName,
	REDACTED_PLACEHOLDER,
	SENSITIVE_KEY_SUBSTRINGS,
	SENSITIVE_KEY_WHITELIST,
};

export function describeArchiveLayout(
	files: readonly CollectedFile[],
): string[] {
	return files.map((f) => relative("", f.archivePath));
}
