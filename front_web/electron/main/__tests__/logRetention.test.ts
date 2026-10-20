import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cleanupExpiredLogFiles, LOG_RETENTION_DAYS } from "../logRetention";

function daysAgo(now: Date, days: number): Date {
	const d = new Date(now);
	d.setDate(d.getDate() - days);
	return d;
}

function formatDate(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("logRetention", () => {
	let dir: string;
	const now = new Date("2025-06-15T12:00:00Z");

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "log-retention-test-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("deletes files older than the retention window", () => {
		const old = daysAgo(now, LOG_RETENTION_DAYS + 1);
		const oldPath = join(dir, `${formatDate(old)}.log`);
		writeFileSync(oldPath, "old");
		utimesSync(oldPath, old, old);

		const result = cleanupExpiredLogFiles(dir, {
			now,
			retentionDays: LOG_RETENTION_DAYS,
		});
		expect(result.deletedFiles).toContain(`${formatDate(old)}.log`);
		expect(readdirSync(dir)).not.toContain(`${formatDate(old)}.log`);
	});

	it("keeps files inside the retention window", () => {
		const recent = daysAgo(now, LOG_RETENTION_DAYS - 1);
		const recentPath = join(dir, `${formatDate(recent)}.log`);
		writeFileSync(recentPath, "recent");
		utimesSync(recentPath, recent, recent);

		const result = cleanupExpiredLogFiles(dir, {
			now,
			retentionDays: LOG_RETENTION_DAYS,
		});
		expect(result.deletedFiles).not.toContain(`${formatDate(recent)}.log`);
		expect(readdirSync(dir)).toContain(`${formatDate(recent)}.log`);
	});

	it("ignores non-.log files", () => {
		const old = daysAgo(now, LOG_RETENTION_DAYS + 5);
		const txtPath = join(dir, `${formatDate(old)}.txt`);
		writeFileSync(txtPath, "not a log");
		utimesSync(txtPath, old, old);

		const result = cleanupExpiredLogFiles(dir, {
			now,
			retentionDays: LOG_RETENTION_DAYS,
		});
		expect(result.deletedFiles).toHaveLength(0);
		expect(readdirSync(dir)).toContain(`${formatDate(old)}.txt`);
	});

	it("rejects invalid date strings in filenames", () => {
		// `2025-02-30` is not a real date; the parser must refuse it rather than roll over.
		const bogusPath = join(dir, "2025-02-30.log");
		writeFileSync(bogusPath, "bogus");

		const result = cleanupExpiredLogFiles(dir, {
			now,
			retentionDays: LOG_RETENTION_DAYS,
		});
		expect(result.deletedFiles).toHaveLength(0);
		expect(readdirSync(dir)).toContain("2025-02-30.log");
	});

	it("reports failures without throwing", () => {
		// A subdirectory named like a log file should be skipped, not crash the sweep.
		mkdirSync(join(dir, "2020-01-01.log"));
		const result = cleanupExpiredLogFiles(dir, {
			now,
			retentionDays: LOG_RETENTION_DAYS,
		});
		expect(Array.isArray(result.deletedFiles)).toBe(true);
		expect(Array.isArray(result.failedFiles)).toBe(true);
	});

	it("returns empty result for a missing directory", () => {
		const result = cleanupExpiredLogFiles(join(dir, "does-not-exist"), {
			now,
			retentionDays: LOG_RETENTION_DAYS,
		});
		expect(result.deletedFiles).toHaveLength(0);
		expect(result.failedFiles).toHaveLength(0);
	});
});
