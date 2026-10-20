import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../../src/app.js";
import { API_PREFIX } from "../../src/config/constants.js";
import { env } from "../../src/config/env.js";

/**
 * B4 end-to-end coverage for the desktop intake endpoints the Electron shell depends on:
 * feedback, crash-report and the release manifest. These never touch Prisma (a crashing shell has
 * no session and intake must survive a DB outage), so the suite runs unconditionally and points
 * DESKTOP_DATA_ROOT at a throwaway temp dir instead of the repo's `.data/`.
 */

const desktopBase = `${API_PREFIX}/desktop`;

// The shared `env` object is mutable and read at call time, so a suite can flip release config.
// Save every field we touch and restore it in afterAll so nothing leaks (vitest isolates files, but
// belt-and-braces keeps this suite order-independent).
const saved = {
	root: env.DESKTOP_DATA_ROOT,
	version: env.DESKTOP_RELEASE_VERSION,
	path: env.DESKTOP_RELEASE_PATH,
	notes: env.DESKTOP_RELEASE_NOTES,
	sha512: env.DESKTOP_RELEASE_SHA512,
	date: env.DESKTOP_RELEASE_DATE,
	forced: env.DESKTOP_RELEASE_FORCED,
};

let workDir: string;

beforeAll(async () => {
	workDir = await mkdtemp(join(tmpdir(), "desktop-intake-"));
	env.DESKTOP_DATA_ROOT = workDir;
	env.DESKTOP_RELEASE_VERSION = undefined;
	env.DESKTOP_RELEASE_PATH = undefined;
});

afterAll(async () => {
	Object.assign(env, saved);
	await rm(workDir, { recursive: true, force: true });
});

describe("POST /api/desktop/feedback", () => {
	it("accepts feedback and persists a JSON record keyed by the returned id", async () => {
		const response = await app.request(`${desktopBase}/feedback`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				text: "crash on export",
				email: "user@vanlife.test",
				appVersion: "0.57.4",
				platform: "darwin-arm64",
			}),
		});

		expect(response.status).toBe(201);
		const body = (await response.json()) as { received: true; id: string };
		expect(body.received).toBe(true);
		expect(typeof body.id).toBe("string");

		const stored = JSON.parse(
			await readFile(join(workDir, "feedback", `${body.id}.json`), "utf8"),
		);
		expect(stored.text).toBe("crash on export");
		expect(stored.email).toBe("user@vanlife.test");
		expect(typeof stored.receivedAt).toBe("string");
	});

	it("rejects an empty text with a 400 schema failure", async () => {
		const response = await app.request(`${desktopBase}/feedback`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "" }),
		});

		expect(response.status).toBe(400);
	});
});

describe("POST /api/desktop/crash-report", () => {
	it("stores the raw dump verbatim and records transport metadata", async () => {
		const bytes = new Uint8Array([0x4d, 0x44, 0x4d, 0x50, 1, 2, 3, 4]);
		const response = await app.request(`${desktopBase}/crash-report`, {
			method: "POST",
			headers: {
				"Content-Type": "application/octet-stream",
				"X-Platform": "darwin-arm64",
				"X-Release-Channel": "beta",
			},
			body: bytes,
		});

		expect(response.status).toBe(202);
		const body = (await response.json()) as { received: true; id: string };
		expect(body.received).toBe(true);

		const stored = await readFile(join(workDir, "crash", `${body.id}.dmp`));
		expect(new Uint8Array(stored)).toEqual(bytes);

		const meta = JSON.parse(
			await readFile(join(workDir, "crash", `${body.id}.json`), "utf8"),
		);
		expect(meta.platform).toBe("darwin-arm64");
		expect(meta.channel).toBe("beta");
		expect(meta.size).toBe(bytes.byteLength);
	});
});

describe("GET /api/desktop/releases/manifest", () => {
	it("404s when no release is published (shell reads this as update-not-available)", async () => {
		env.DESKTOP_RELEASE_VERSION = undefined;
		env.DESKTOP_RELEASE_PATH = undefined;

		const response = await app.request(
			`${desktopBase}/releases/manifest?platform=darwin-arm64&channel=stable`,
		);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			message: "No release published for this platform/channel.",
		});
	});

	it("renders flat YAML the shell's parseManifestYaml accepts when a release is configured", async () => {
		env.DESKTOP_RELEASE_VERSION = "9.9.9";
		env.DESKTOP_RELEASE_PATH = "Harness-9.9.9-arm64.dmg";
		env.DESKTOP_RELEASE_SHA512 = "abc123";
		env.DESKTOP_RELEASE_DATE = "2026-10-20T10:00:00Z";
		env.DESKTOP_RELEASE_NOTES = "- fixed export\n- faster boot";
		env.DESKTOP_RELEASE_FORCED = "true";

		const response = await app.request(
			`${desktopBase}/releases/manifest?platform=darwin-arm64&channel=stable`,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/yaml");

		const yaml = await response.text();
		expect(yaml).toContain("version: 9.9.9");
		expect(yaml).toContain("path: Harness-9.9.9-arm64.dmg");
		expect(yaml).toContain("sha512: abc123");
		expect(yaml).toContain("releaseDate: '2026-10-20T10:00:00Z'");
		expect(yaml).toContain("is_forced: true");
		expect(yaml).toContain("releaseNotes: |");
		expect(yaml).toContain("  - fixed export");
	});
});

describe("GET /api/desktop/releases/download/{filename}", () => {
	it("serves a staged artifact and 404s for a missing one", async () => {
		const releasesDir = join(workDir, "releases");
		await mkdir(releasesDir, { recursive: true });
		const artifact = new Uint8Array([9, 8, 7, 6]);
		await writeFile(join(releasesDir, "Harness-9.9.9-arm64.dmg"), artifact);

		const found = await app.request(
			`${desktopBase}/releases/download/Harness-9.9.9-arm64.dmg`,
		);
		expect(found.status).toBe(200);
		expect(new Uint8Array(await found.arrayBuffer())).toEqual(artifact);

		const missing = await app.request(
			`${desktopBase}/releases/download/does-not-exist.dmg`,
		);
		expect(missing.status).toBe(404);
	});
});
