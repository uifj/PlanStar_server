import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../../src/app.js";
import { API_PREFIX } from "../../src/config/constants.js";
import { env } from "../../src/config/env.js";
import { sweepExpired } from "../../src/modules/desktop-logs/service.js";

/**
 * Log uplink end to end: anonymous write, operator-only read, quota, and retention.
 *
 * Like the desktop intake suite this never touches Prisma (intake has to survive a DB outage), so it
 * runs unconditionally against a temp `DESKTOP_LOG_ROOT`.
 */

const logsBase = `${API_PREFIX}/desktop/logs`;
const TOKEN = "test-operator-token-0123456789";
const DEVICE = "device-abcdef123456";

const saved = {
	root: env.DESKTOP_LOG_ROOT,
	token: env.DESKTOP_LOG_READ_TOKEN,
	quota: env.DESKTOP_LOG_DAILY_QUOTA_BYTES,
	retention: env.DESKTOP_LOG_RETENTION_DAYS,
};

let workDir: string;

const ndjson = (records: unknown[]): string =>
	`${records.map((record) => JSON.stringify(record)).join("\n")}\n`;

beforeAll(async () => {
	workDir = await mkdtemp(join(tmpdir(), "desktop-logs-"));
	env.DESKTOP_LOG_ROOT = workDir;
	env.DESKTOP_LOG_READ_TOKEN = TOKEN;
	env.DESKTOP_LOG_DAILY_QUOTA_BYTES = 50 * 1024 * 1024;
	env.DESKTOP_LOG_RETENTION_DAYS = 14;
});

afterAll(async () => {
	Object.assign(env, saved);
	await rm(workDir, { recursive: true, force: true });
});

function postLogs(
	deviceId: string,
	body: Uint8Array | string,
	headers: Record<string, string> = {},
): Promise<Response> {
	return Promise.resolve(
		app.request(`${logsBase}?deviceId=${encodeURIComponent(deviceId)}`, {
			method: "POST",
			headers: { "Content-Type": "application/x-ndjson", ...headers },
			body: body as BodyInit,
		}),
	);
}

function getLogs(query = ""): Promise<Response> {
	return Promise.resolve(
		app.request(`${logsBase}${query}`, {
			headers: { Authorization: `Bearer ${TOKEN}` },
		}),
	);
}

describe("POST /api/desktop/logs", () => {
	it("appends NDJSON to the device/day file and reads it back", async () => {
		const response = await postLogs(
			DEVICE,
			ndjson([
				{
					time: "2026-05-01T10:00:00.000Z",
					level: "info",
					source: "main",
					message: "boot",
				},
				{
					time: "2026-05-01T10:00:01.000Z",
					level: "error",
					source: "main",
					message: "export failed",
				},
			]),
		);

		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({
			received: true,
			appended: 2,
			dropped: 0,
		});

		const onDisk = await readFile(
			join(workDir, DEVICE, "2026-05-01.ndjson"),
			"utf8",
		);
		expect(onDisk.trimEnd().split("\n")).toHaveLength(2);

		const read = await getLogs(`?deviceId=${DEVICE}&date=2026-05-01`);
		expect(read.status).toBe(200);
		const body = (await read.json()) as {
			records: { message?: string; deviceId: string; date: string }[];
			matched: number;
			truncated: boolean;
		};
		expect(body.matched).toBe(2);
		expect(body.truncated).toBe(false);
		expect(body.records.map((record) => record.message)).toEqual([
			"boot",
			"export failed",
		]);
		expect(body.records[0]?.deviceId).toBe(DEVICE);
		expect(body.records[0]?.date).toBe("2026-05-01");
	});

	it("accepts a gzipped batch", async () => {
		const device = "gzip-device-000001";
		const gz = gzipSync(
			Buffer.from(
				ndjson([
					{
						time: "2026-05-02T00:00:00.000Z",
						level: "warn",
						message: "compressed line",
					},
				]),
			),
		);

		const response = await postLogs(device, new Uint8Array(gz), {
			"Content-Type": "application/gzip",
			"Content-Encoding": "gzip",
		});

		expect(response.status).toBe(202);
		const read = await getLogs(`?deviceId=${device}`);
		const body = (await read.json()) as { records: { message?: string }[] };
		expect(body.records[0]?.message).toBe("compressed line");
	});

	it("buckets a replayed spool by the record's own day, not by upload time", async () => {
		const device = "spool-device-00001";
		await postLogs(
			device,
			ndjson([
				{ time: "2026-04-30T23:59:00.000Z", message: "before midnight" },
				{ time: "2026-05-01T00:01:00.000Z", message: "after midnight" },
			]),
		);

		const files = await readdir(join(workDir, device));
		expect(files.sort()).toEqual(["2026-04-30.ndjson", "2026-05-01.ndjson"]);
	});

	it("rejects a malformed device id", async () => {
		const response = await postLogs("../escape", ndjson([{ message: "x" }]));
		expect(response.status).toBe(400);
	});

	it("rejects a batch with no parsable record", async () => {
		const response = await postLogs(DEVICE, "not json\nstill not json\n");
		expect(response.status).toBe(400);
	});

	it("answers 429 with Retry-After once the daily quota is spent", async () => {
		const device = "quota-device-00001";
		env.DESKTOP_LOG_DAILY_QUOTA_BYTES = 200;

		const first = await postLogs(
			device,
			ndjson([{ time: "2026-05-03T00:00:00.000Z", message: "a".repeat(60) }]),
		);
		expect(first.status).toBe(202);

		const second = await postLogs(
			device,
			ndjson([{ time: "2026-05-03T00:00:01.000Z", message: "b".repeat(300) }]),
		);
		expect(second.status).toBe(429);
		expect(second.headers.get("retry-after")).toBe("60");

		env.DESKTOP_LOG_DAILY_QUOTA_BYTES = 50 * 1024 * 1024;
	});
});

describe("GET /api/desktop/logs", () => {
	it("answers 404 when no read token is configured (surface closed, not open)", async () => {
		env.DESKTOP_LOG_READ_TOKEN = undefined;
		const response = await app.request(logsBase);
		expect(response.status).toBe(404);

		const devices = await app.request(`${logsBase}/devices`);
		expect(devices.status).toBe(404);

		env.DESKTOP_LOG_READ_TOKEN = TOKEN;
	});

	it("rejects a wrong or missing bearer token with 401", async () => {
		const wrong = await app.request(logsBase, {
			headers: { Authorization: "Bearer nope" },
		});
		expect(wrong.status).toBe(401);

		const missing = await app.request(logsBase);
		expect(missing.status).toBe(401);
	});

	it("filters by substring and keeps the newest `limit` records", async () => {
		const device = "filter-device-00001";
		await postLogs(
			device,
			ndjson([
				{ time: "2026-05-04T00:00:01.000Z", message: "alpha one" },
				{ time: "2026-05-04T00:00:02.000Z", message: "beta two" },
				{ time: "2026-05-04T00:00:03.000Z", message: "alpha three" },
			]),
		);

		const filtered = await getLogs(`?deviceId=${device}&q=ALPHA`);
		const body = (await filtered.json()) as {
			records: { message?: string }[];
			matched: number;
		};
		expect(body.matched).toBe(2);
		expect(body.records.map((record) => record.message)).toEqual([
			"alpha one",
			"alpha three",
		]);

		const limited = await getLogs(`?deviceId=${device}&limit=1`);
		const trimmedBody = (await limited.json()) as {
			records: { message?: string }[];
			truncated: boolean;
		};
		expect(trimmedBody.records).toHaveLength(1);
		expect(trimmedBody.records[0]?.message).toBe("alpha three");
		expect(trimmedBody.truncated).toBe(true);
	});

	it("lists devices with retained days and byte totals", async () => {
		const response = await app.request(`${logsBase}/devices`, {
			headers: { Authorization: `Bearer ${TOKEN}` },
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			devices: { deviceId: string; days: number; bytes: number }[];
		};
		const entry = body.devices.find((device) => device.deviceId === DEVICE);
		expect(entry).toBeDefined();
		expect(entry?.days).toBeGreaterThanOrEqual(1);
		expect(entry?.bytes).toBeGreaterThan(0);
	});
});

describe("sweepExpired", () => {
	it("deletes only day-files older than the retention window and prunes empty device dirs", async () => {
		const device = "retention-device-1";
		const dir = join(workDir, device);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "2020-01-01.ndjson"), "{}\n");
		await writeFile(join(dir, "2999-01-01.ndjson"), "{}\n");

		const expiredOnly = "retention-device-2";
		await mkdir(join(workDir, expiredOnly), { recursive: true });
		await writeFile(join(workDir, expiredOnly, "2020-01-02.ndjson"), "{}\n");

		const result = await sweepExpired(new Date("2026-05-10T00:00:00.000Z"));

		expect(result.deletedFiles).toContain(`${device}/2020-01-01.ndjson`);
		expect(result.deletedFiles).toContain(`${expiredOnly}/2020-01-02.ndjson`);
		expect(result.failedFiles).toEqual([]);

		// The retained file survives, the fully-expired device directory is gone.
		expect(await readdir(dir)).toEqual(["2999-01-01.ndjson"]);
		await expect(readdir(join(workDir, expiredOnly))).rejects.toThrow();
	});
});
