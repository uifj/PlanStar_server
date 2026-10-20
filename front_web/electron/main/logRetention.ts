import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * Daily-rotated log files accumulate without bound; the shell runs on laptops that are rarely
 * restarted, so the cleanup pass happens once at boot and drops anything older than the retention
 * window. Two weeks is long enough for a user to file a bug report with logs attached, short
 * enough that a stuck install does not eat gigabytes.
 */
export const LOG_RETENTION_DAYS = 14;

const LOG_FILE_NAME_RE = /^(\d{4})-(\d{2})-(\d{2})\.log$/;

function getStartOfLocalDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseLogDateFromFileName(fileName: string): Date | null {
	const match = LOG_FILE_NAME_RE.exec(fileName);
	if (!match) {
		return null;
	}

	const [, yearText, monthText, dayText] = match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const parsed = new Date(year, month - 1, day);

	// Reject `2024-02-30` and friends: the Date constructor rolls them into the next month, which
	// would silently mark a misnamed file as fresh and skip it forever.
	if (
		parsed.getFullYear() !== year ||
		parsed.getMonth() !== month - 1 ||
		parsed.getDate() !== day
	) {
		return null;
	}

	return parsed;
}

function getLogRetentionCutoffDate(
	now: Date,
	retentionDays: number = LOG_RETENTION_DAYS,
): Date {
	const cutoff = getStartOfLocalDay(now);
	cutoff.setDate(cutoff.getDate() - Math.max(retentionDays - 1, 0));
	return cutoff;
}

export function shouldDeleteExpiredLogFile(
	fileName: string,
	now: Date,
	retentionDays: number = LOG_RETENTION_DAYS,
): boolean {
	const fileDate = parseLogDateFromFileName(fileName);
	if (!fileDate) {
		return false;
	}

	return fileDate < getLogRetentionCutoffDate(now, retentionDays);
}

export interface LogRetentionCleanupResult {
	deletedFiles: string[];
	failedFiles: string[];
}

export function cleanupExpiredLogFiles(
	logDir: string,
	options?: {
		now?: Date;
		retentionDays?: number;
	},
): LogRetentionCleanupResult {
	const now = options?.now ?? new Date();
	const retentionDays = options?.retentionDays ?? LOG_RETENTION_DAYS;

	try {
		const deletedFiles: string[] = [];
		const failedFiles: string[] = [];
		const entries = readdirSync(logDir, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isFile()) {
				continue;
			}

			if (!shouldDeleteExpiredLogFile(entry.name, now, retentionDays)) {
				continue;
			}

			const filePath = join(logDir, entry.name);
			try {
				unlinkSync(filePath);
				deletedFiles.push(entry.name);
			} catch {
				// A file we cannot delete (permissions, open handle) is reported but never fatal:
				// losing one old log is fine, refusing to boot over it is not.
				failedFiles.push(entry.name);
			}
		}

		return { deletedFiles, failedFiles };
	} catch {
		// A missing/unreadable log directory means there is nothing to clean; stay quiet.
		return { deletedFiles: [], failedFiles: [] };
	}
}
