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

	it("serves a metadata-only release (no `path`) so a policy entry needs no artifact", async () => {
		env.DESKTOP_RELEASE_VERSION = "9.9.9";
		env.DESKTOP_RELEASE_PATH = undefined;
		env.DESKTOP_RELEASE_FORCED = "true";

		const response = await app.request(
			`${desktopBase}/releases/manifest?platform=darwin-arm64&channel=stable`,
		);

		expect(response.status).toBe(200);
		const yaml = await response.text();
		expect(yaml).toContain("version: 9.9.9");
		// A bare `path:` line would be an empty value, which the shell would read as "" instead of
		// "absent", so the line is omitted entirely.
		expect(yaml).not.toMatch(/^path:/m);
		expect(yaml).toContain("is_forced: true");
	});
});

describe("GET /api/desktop/releases/download/{filename}", () => {
	it("serves an artifact the feed references and 404s otherwise", async () => {
		const releasesDir = join(workDir, "releases");
		await mkdir(releasesDir, { recursive: true });
		const artifact = new Uint8Array([9, 8, 7, 6]);
		await writeFile(join(releasesDir, "Harness-9.9.9-arm64.dmg"), artifact);
		await writeFile(
			join(releasesDir, "latest-mac.yml"),
			[
				"version: 9.9.9",
				"path: Harness-9.9.9-arm64.dmg",
				"sha512: abc123",
				"",
			].join("\n"),
		);

		const found = await app.request(
			`${desktopBase}/releases/download/Harness-9.9.9-arm64.dmg`,
		);
		expect(found.status).toBe(200);
		expect(found.headers.get("content-type")).toContain("application/zip");
		expect(new Uint8Array(await found.arrayBuffer())).toEqual(artifact);

		// Staged but not named by any published feed: the route is not a file reader.
		await writeFile(join(releasesDir, "stray.dmg"), artifact);
		const stray = await app.request(
			`${desktopBase}/releases/download/stray.dmg`,
		);
		expect(stray.status).toBe(404);

		const missing = await app.request(
			`${desktopBase}/releases/download/does-not-exist.dmg`,
		);
		expect(missing.status).toBe(404);
	});
});

describe("GET /api/desktop/releases/feed/{filename}", () => {
	it("serves electron-builder metadata verbatim", async () => {
		const releasesDir = join(workDir, "releases");
		await mkdir(releasesDir, { recursive: true });
		const yaml = [
			"version: 9.9.9",
			"files:",
			"  - url: Harness-9.9.9-arm64-mac.zip",
			"    sha512: abc123",
			"path: Harness-9.9.9-arm64-mac.zip",
			"sha512: abc123",
			"releaseDate: '2026-10-21T00:00:00.000Z'",
			"",
		].join("\n");
		await writeFile(join(releasesDir, "latest-mac.yml"), yaml);

		const response = await app.request(
			`${desktopBase}/releases/feed/latest-mac.yml`,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/yaml");
		expect(await response.text()).toBe(yaml);
	});

	it("accepts only builder metadata names", async () => {
		const traversal = await app.request(
			`${desktopBase}/releases/feed/..%2F..%2Fetc%2Fpasswd`,
		);
		expect(traversal.status).toBe(404);

		const missing = await app.request(
			`${desktopBase}/releases/feed/latest.yml`,
		);
		expect(missing.status).toBe(404);
	});

	/**
	 * The regression this suite exists for: electron-updater resolves `path` relative to the feed
	 * URL, so the archive request lands on this same route. A yml-only route 400/404s every update.
	 */
	it("serves the archive the metadata names, including spaces", async () => {
		const releasesDir = join(workDir, "releases");
		const name = "Planstar-9.9.9-arm64-mac.zip";
		const artifact = new Uint8Array([1, 2, 3, 4, 5]);
		await writeFile(join(releasesDir, name), artifact);
		await writeFile(
			join(releasesDir, "latest-mac.yml"),
			[
				"version: 9.9.9",
				"files:",
				`  - url: ${name}`,
				"    sha512: abc123",
				`path: ${name}`,
				"sha512: abc123",
				"",
			].join("\n"),
		);

		const response = await app.request(
			`${desktopBase}/releases/feed/${encodeURIComponent(name)}`,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/zip");
		expect(response.headers.get("content-length")).toBe(
			String(artifact.byteLength),
		);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(artifact);
	});

	it("rejects an archive no feed references", async () => {
		const response = await app.request(
			`${desktopBase}/releases/feed/unreferenced.zip`,
		);
		expect(response.status).toBe(404);
	});
});
