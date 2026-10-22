#!/usr/bin/env node
/**
 * Desktop release metadata contract check.
 *
 * electron-builder emits two things into `build/`: the update metadata (`latest-mac.yml`) and the
 * archive it names. electron-updater trusts the metadata blindly — if `path` / `files[].url` and the
 * staged archive disagree, every client fails after downloading 150 MB, and the failure looks like a
 * network error. This script pins the pair before anything is published:
 *
 *   1. every referenced archive exists next to the yml;
 *   2. the yml's sha512 (base64) is the archive's sha512 (base64);
 *   3. the yml's version equals front_web/package.json.
 *
 * Usage: `node scripts/verify-desktop-feed.mjs [--dir build]` (or `pnpm verify:desktop-feed`).
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function parseArgs(argv) {
	let dir = "build";
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === "--dir" && argv[i + 1]) {
			dir = argv[i + 1];
			i += 1;
		}
	}
	return { dir: resolve(repoRoot, dir) };
}

function unquote(value) {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/**
 * Minimal reader for the flat shape electron-builder writes. Not a YAML parser: only the keys that
 * decide whether an update can install are read, so a formatting change surfaces as "missing field"
 * rather than silently passing.
 */
function parseFeed(source) {
	const feed = { version: null, path: null, sha512: null, files: [] };
	const lines = source.split(/\r?\n/);
	let currentFile = null;
	let index = 0;

	while (index < lines.length) {
		const line = lines[index];
		const indent = line.match(/^\s*/)[0].length;
		const body = line.slice(indent);

		const readScalar = (raw) => {
			const value = raw.trim();
			if (value === "|" || value === "|-" || value === ">" || value === ">-") {
				const collected = [];
				index += 1;
				while (index < lines.length) {
					const next = lines[index];
					const nextIndent = next.match(/^\s*/)[0].length;
					if (next.trim().length > 0 && nextIndent <= indent) {
						index -= 1;
						break;
					}
					collected.push(next.trim());
					index += 1;
				}
				return collected.join("");
			}
			return unquote(value);
		};

		if (indent === 0 && body.startsWith("version:")) {
			feed.version = readScalar(body.slice("version:".length));
		} else if (indent === 0 && body.startsWith("path:")) {
			feed.path = readScalar(body.slice("path:".length));
		} else if (indent === 0 && body.startsWith("sha512:")) {
			feed.sha512 = readScalar(body.slice("sha512:".length));
		} else if (/^-\s*url:/.test(body)) {
			currentFile = {
				url: readScalar(body.replace(/^-\s*url:/, "")),
				sha512: null,
			};
			feed.files.push(currentFile);
		} else if (currentFile && body.startsWith("sha512:")) {
			currentFile.sha512 = readScalar(body.slice("sha512:".length));
		}

		index += 1;
	}

	return feed;
}

function sha512Base64(path) {
	return createHash("sha512").update(readFileSync(path)).digest("base64");
}

/**
 * Only update metadata is checked. `builder-debug.yml` lives in the same directory and is not a
 * feed, so it must not be read as one (it has neither version nor path).
 */
const FEED_METADATA_NAME = /^(latest|beta|alpha|next)(-[a-z0-9]+)?\.ya?ml$/;

function main() {
	const { dir } = parseArgs(process.argv.slice(2));
	const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

	if (!existsSync(dir)) {
		console.error(`✗ release metadata directory not found: ${dir}`);
		process.exit(1);
	}

	const feeds = readdirSync(dir).filter((name) =>
		FEED_METADATA_NAME.test(name),
	);
	if (feeds.length === 0) {
		console.error(`✗ no update metadata (latest*.yml) found in ${dir}`);
		console.error("  Run `pnpm dist:mac` first (electron-builder writes it).");
		process.exit(1);
	}

	const problems = [];
	let checkedArtifacts = 0;

	for (const feedName of feeds) {
		const feedPath = join(dir, feedName);
		const source = readFileSync(feedPath, "utf8");
		const feed = parseFeed(source);

		if (!feed.version) {
			problems.push(`${feedName}: missing version`);
		} else if (feed.version !== pkg.version) {
			problems.push(
				`${feedName}: version ${feed.version} does not match package.json ${pkg.version}`,
			);
		}

		const artifacts = feed.files
			.filter((file) => file.url)
			.map((file) => ({ name: file.url, sha512: file.sha512 ?? feed.sha512 }));
		if (
			feed.path &&
			!artifacts.some((artifact) => artifact.name === feed.path)
		) {
			artifacts.push({ name: feed.path, sha512: feed.sha512 });
		}
		if (artifacts.length === 0) {
			problems.push(`${feedName}: no path/files[].url entry`);
		}

		for (const artifact of artifacts) {
			const artifactPath = join(dir, artifact.name);
			if (!existsSync(artifactPath)) {
				problems.push(
					`${feedName}: references missing artifact ${artifact.name}`,
				);
				continue;
			}
			if (!statSync(artifactPath).isFile()) {
				problems.push(`${feedName}: ${artifact.name} is not a file`);
				continue;
			}
			checkedArtifacts += 1;

			if (!artifact.sha512) {
				problems.push(`${feedName}: ${artifact.name} has no sha512`);
				continue;
			}
			const actual = sha512Base64(artifactPath);
			if (actual !== artifact.sha512) {
				problems.push(
					`${feedName}: ${artifact.name} sha512 mismatch (metadata ${artifact.sha512.slice(0, 16)}…, file ${actual.slice(0, 16)}…)`,
				);
			}
		}
	}

	if (problems.length === 0) {
		console.log(
			`✓ desktop feed OK (${feeds.length} metadata file(s), ${checkedArtifacts} artifact check(s), version ${pkg.version})`,
		);
		process.exit(0);
	}

	console.error("✗ desktop feed contract FAILED");
	for (const problem of problems) {
		console.error(`    - ${problem}`);
	}
	console.error("");
	console.error(
		"  The updater downloads the archive named in the yml and verifies its sha512, so a mismatch",
	);
	console.error(
		"  breaks every client after the download. Rebuild the release.",
	);
	process.exit(1);
}

main();
