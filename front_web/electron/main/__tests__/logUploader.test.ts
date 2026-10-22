import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The uplink is the part of the shell that has to work when everything else is broken, so its
 * failure modes are pinned here rather than discovered in the field:
 *   - a burst is batched and gzipped, not one request per line;
 *   - an offline batch lands in the spool instead of being dropped, and the spool is replayed;
 *   - the spool stays bounded;
 *   - `dispose()` never loses the tail.
 */

vi.mock("electron", () => ({
	app: {
		getPath: () => "/tmp/log-uploader-test",
		getVersion: () => "0.0.0-test",
		isPackaged: false,
	},
	crashReporter: { start: () => undefined },
}));

import {
	bindFileLogger,
	bindLogger,
	consoleLogger,
	initLogger,
	logger,
} from "../logger";
import { initLogUploader, MAX_SPOOL_FILES } from "../logUploader";

let workDir: string;

beforeEach(() => {
	workDir = mkdtempSync(join(tmpdir(), "log-uploader-"));
	initLogger({ logDir: join(workDir, "logs") });
	bindFileLogger();
});

afterEach(() => {
	bindLogger(consoleLogger);
	rmSync(workDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

interface Captured {
	url: string;
	body: Uint8Array;
}

function okFetch(captured: Captured[]): typeof fetch {
	return (async (url: string, init: RequestInit) => {
		captured.push({ url, body: new Uint8Array(init.body as Uint8Array) });
		return new Response("{}", { status: 202 });
	}) as unknown as typeof fetch;
}

const offlineFetch = (() =>
	Promise.reject(new Error("offline"))) as unknown as typeof fetch;

const recordsOf = (body: Uint8Array): { level: string; message: string }[] =>
	gunzipSync(body)
		.toString("utf8")
		.trimEnd()
		.split("\n")
		.map((line) => JSON.parse(line));

describe("logUploader", () => {
	it("batches records and gzips them to the device endpoint", async () => {
		const captured: Captured[] = [];
		const uploader = initLogUploader({
			apiBaseUrl: () => "https://api.example.test",
			deviceId: () => "device-abcdef123456",
			appVersion: () => "1.2.3",
			platform: () => "darwin-arm64",
			spoolDir: () => join(workDir, "spool"),
			batchSize: 3,
			fetchImpl: okFetch(captured),
		});

		logger.info("one");
		logger.warn("two");
		logger.error("three");

		await vi.waitFor(() => expect(captured).toHaveLength(1));
		const [request] = captured;
		expect(request?.url).toBe(
			"https://api.example.test/api/desktop/logs?deviceId=device-abcdef123456&appVersion=1.2.3&platform=darwin-arm64",
		);
		expect(recordsOf(request!.body).map((record) => record.message)).toEqual([
			"one",
			"two",
			"three",
		]);
		expect(uploader.pending()).toBe(0);

		await uploader.dispose();
	});

	it("spools the batch when the network is down and replays it later", async () => {
		let offline = true;
		const captured: Captured[] = [];
		const uploader = initLogUploader({
			apiBaseUrl: () => "https://api.example.test",
			deviceId: () => "device-abcdef123456",
			spoolDir: () => join(workDir, "spool"),
			batchSize: 2,
			backoffMs: [10_000],
			fetchImpl: ((url: string, init: RequestInit) => {
				if (offline) {
					return Promise.reject(new Error("offline"));
				}
				captured.push({ url, body: new Uint8Array(init.body as Uint8Array) });
				return Promise.resolve(new Response("{}", { status: 202 }));
			}) as unknown as typeof fetch,
		});

		logger.info("while offline a");
		logger.info("while offline b");

		await vi.waitFor(() => expect(uploader.spooled()).toBe(1));
		expect(uploader.pending()).toBe(0);

		// Network comes back: flush drains the spool before anything new is sent.
		offline = false;
		expect(await uploader.flush()).toBe(true);
		expect(uploader.spooled()).toBe(0);
		expect(captured.flatMap((entry) => recordsOf(entry.body))).toHaveLength(2);

		await uploader.dispose();
	});

	it("keeps the spool bounded, dropping the oldest files first", async () => {
		const spoolDir = join(workDir, "spool");
		mkdirSync(spoolDir, { recursive: true });
		// Pre-seed well past the cap; a failed batch triggers the prune.
		for (let index = 0; index < MAX_SPOOL_FILES + 5; index += 1) {
			writeFileSync(
				join(spoolDir, `${String(index).padStart(14, "0")}-seed.ndjson.gz`),
				"x",
			);
		}
		const uploader = initLogUploader({
			apiBaseUrl: () => "https://api.example.test",
			deviceId: () => "device-abcdef123456",
			spoolDir: () => spoolDir,
			// Never auto-flush: the test drives the single flush below, so the assertion is not racing a
			// background retry.
			batchSize: 100,
			backoffMs: [10_000],
			fetchImpl: offlineFetch,
		});

		logger.info("overflow");
		expect(await uploader.flush()).toBe(false);

		const names = readdirSync(spoolDir).sort();
		expect(names).toHaveLength(MAX_SPOOL_FILES);
		// The oldest seeds were dropped; the newest files (the incident) survive.
		expect(names[0]).not.toBe("00000000000000-seed.ndjson.gz");

		await uploader.dispose();
	});

	it("drops a batch the server will never accept instead of retrying forever", async () => {
		const uploader = initLogUploader({
			apiBaseUrl: () => "https://api.example.test",
			deviceId: () => "device-abcdef123456",
			spoolDir: () => join(workDir, "spool"),
			batchSize: 1,
			fetchImpl: (() =>
				Promise.resolve(
					new Response("{}", { status: 400 }),
				)) as unknown as typeof fetch,
		});

		logger.info("malformed");

		await vi.waitFor(() => expect(uploader.pending()).toBe(0));
		expect(uploader.spooled()).toBe(0);

		await uploader.dispose();
	});

	it("spools whatever is still queued on dispose", async () => {
		const captured: Captured[] = [];
		const uploader = initLogUploader({
			apiBaseUrl: () => "https://api.example.test",
			deviceId: () => "device-abcdef123456",
			spoolDir: () => join(workDir, "spool"),
			// A high threshold means nothing is sent until dispose.
			batchSize: 100,
			fetchImpl: okFetch(captured),
		});

		logger.info("tail a");
		logger.info("tail b");
		expect(uploader.pending()).toBe(2);

		await uploader.dispose();

		// dispose attempts one flush; with a reachable server the records go out.
		expect(captured).toHaveLength(1);
		expect(recordsOf(captured[0]!.body)).toHaveLength(2);
		expect(uploader.spooled()).toBe(0);
	});

	it("spools the tail on dispose when the server is unreachable", async () => {
		const uploader = initLogUploader({
			apiBaseUrl: () => "https://api.example.test",
			deviceId: () => "device-abcdef123456",
			spoolDir: () => join(workDir, "spool"),
			batchSize: 100,
			backoffMs: [10_000],
			fetchImpl: offlineFetch,
		});

		logger.info("lost tail");
		await uploader.dispose();

		expect(uploader.spooled()).toBe(1);
	});
});
