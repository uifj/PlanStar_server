import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../../src/config/env.js";
import {
	isFeedMetadataName,
	readFeedFile,
	readFeedIndex,
	resolveServableArtifact,
} from "../../../src/modules/desktop/feed.js";

/**
 * The feed index is what keeps the artifact branch of `/releases/feed/{filename}` from turning into
 * a generic file reader: only names a published yml references may be served. These cases pin the
 * parsing quirks electron-builder actually emits (bare names with spaces, quoted scalars, absolute
 * URLs) plus the two rejection paths.
 */

const savedRoot = env.DESKTOP_DATA_ROOT;
let workDir: string;
let releasesDir: string;

beforeAll(async () => {
	workDir = await mkdtemp(join(tmpdir(), "desktop-feed-"));
	releasesDir = join(workDir, "releases");
	await mkdir(releasesDir, { recursive: true });
	env.DESKTOP_DATA_ROOT = workDir;
});

afterAll(async () => {
	env.DESKTOP_DATA_ROOT = savedRoot;
	await rm(workDir, { recursive: true, force: true });
});

describe("isFeedMetadataName", () => {
	it("accepts the names electron-builder emits", () => {
		expect(isFeedMetadataName("latest-mac.yml")).toBe(true);
		expect(isFeedMetadataName("beta.yml")).toBe(true);
		expect(isFeedMetadataName("next-linux.yml")).toBe(true);
	});

	it("rejects archives and paths", () => {
		expect(isFeedMetadataName("latest-mac.zip")).toBe(false);
		expect(isFeedMetadataName("../latest-mac.yml")).toBe(false);
		expect(isFeedMetadataName("builder-debug.yml")).toBe(false);
	});
});

describe("readFeedIndex", () => {
	it("collects bare, quoted and absolute references", async () => {
		await writeFile(
			join(releasesDir, "latest-mac.yml"),
			[
				"version: 1.2.3",
				"files:",
				'  - url: "Anytype Harness-1.2.3-arm64-mac.zip"',
				"    sha512: abc",
				"  - url: https://cdn.example.test/remote-1.2.3.dmg",
				"    sha512: def",
				"path: 'Anytype Harness-1.2.3-arm64-mac.zip'",
				"",
			].join("\n"),
		);

		const index = await readFeedIndex();

		expect(index.has("Anytype Harness-1.2.3-arm64-mac.zip")).toBe(true);
		expect(index.has("remote-1.2.3.dmg")).toBe(true);
	});

	it("ignores non-feed yml files", async () => {
		await writeFile(
			join(releasesDir, "builder-debug.yml"),
			"version: 1.2.3\npath: debug-only.zip\n",
		);

		const index = await readFeedIndex();

		expect(index.has("debug-only.zip")).toBe(false);
	});

	it("returns an empty set when the releases directory is missing", async () => {
		const previous = env.DESKTOP_DATA_ROOT;
		env.DESKTOP_DATA_ROOT = join(workDir, "does-not-exist");
		try {
			expect((await readFeedIndex()).size).toBe(0);
		} finally {
			env.DESKTOP_DATA_ROOT = previous;
		}
	});
});

describe("resolveServableArtifact", () => {
	it("resolves a referenced archive inside the releases root", async () => {
		const path = await resolveServableArtifact(
			"Anytype Harness-1.2.3-arm64-mac.zip",
		);
		expect(path).toBe(join(releasesDir, "Anytype Harness-1.2.3-arm64-mac.zip"));
	});

	it("rejects anything the feed does not reference", async () => {
		expect(await resolveServableArtifact("stray.zip")).toBeNull();
	});

	it("rejects names carrying a path component", async () => {
		expect(await resolveServableArtifact("../latest-mac.yml")).toBeNull();
		expect(await resolveServableArtifact("nested/stray.zip")).toBeNull();
	});
});

describe("readFeedFile", () => {
	it("returns the metadata verbatim and nothing else", async () => {
		const source = await readFeedFile("latest-mac.yml");
		expect(source).toContain("version: 1.2.3");

		expect(await readFeedFile("latest-mac.zip")).toBeNull();
		expect(await readFeedFile("../latest-mac.yml")).toBeNull();
	});
});
