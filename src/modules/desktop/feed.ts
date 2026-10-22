import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { resolveReleaseArtifactPath } from "./service.js";

/**
 * electron-updater feed: metadata + the artifacts that metadata points at.
 *
 * The updater resolves downloads with `new URL(fileInfo.url, feedUrl)`, and electron-builder writes
 * a *bare file name* into `latest-mac.yml`:
 *
 *   path: Planstar-0.57.4-arm64-mac.zip
 *
 * so the archive request lands on this same feed route as the yml. Serving only `*.yml` here is
 * therefore guaranteed to 400 every real update. The route is split by extension: builder metadata
 * keeps its strict name whitelist, everything else must be an artifact *referenced by a yml in the
 * same directory* — never an arbitrary file read.
 */

const FEED_METADATA_NAME = /^(latest|beta|alpha|next)(-mac|-linux)?\.yml$/;

/** True for the names electron-builder emits for update metadata. */
export function isFeedMetadataName(filename: string): boolean {
	return FEED_METADATA_NAME.test(filename);
}

function releaseRoot(): string {
	return resolve(join(env.DESKTOP_DATA_ROOT, "releases"));
}

/**
 * Strip the quotes YAML allows around scalars, then reduce a value to its basename. `files[].url`
 * may legitimately be absolute (`https://cdn.example/app.zip`), so URLs are unwrapped first.
 */
function normalizeReference(raw: string): string | null {
	let value = raw.trim();
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		value = value.slice(1, -1).trim();
	}
	if (value.length === 0) {
		return null;
	}
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
		try {
			value = new URL(value).pathname;
		} catch {
			return null;
		}
	}
	const name = basename(value);
	return name.length > 0 ? name : null;
}

/**
 * Every artifact name referenced by a `*.yml` under the releases root.
 *
 * Deliberately not a YAML parse: only the two shapes electron-builder emits matter (`path:` and
 * `files[].url:`). A malformed file is logged and skipped so one bad channel cannot break the
 * others.
 */
export async function readFeedIndex(): Promise<Set<string>> {
	const root = releaseRoot();
	const names = new Set<string>();

	let entries: string[];
	try {
		entries = await readdir(root);
	} catch {
		return names;
	}

	for (const entry of entries) {
		// Only published feed metadata may authorize an artifact. `builder-debug.yml` sits in the same
		// directory and lists build paths; indexing it would widen the allowlist to files no updater
		// will ever request.
		if (!isFeedMetadataName(entry)) {
			continue;
		}
		try {
			const source = await readFile(join(root, entry), "utf8");
			for (const match of source.matchAll(
				/^[ \t]*(?:path|-[ \t]*url)[ \t]*:[ \t]*(.+?)[ \t]*$/gm,
			)) {
				const name = normalizeReference(match[1]);
				if (name) {
					names.add(name);
				}
			}
		} catch (error) {
			logger.warn(
				{ err: error, feedFile: entry },
				"desktop release feed index: unreadable metadata",
			);
		}
	}

	return names;
}

/** Read one builder metadata file verbatim; `null` for anything that is not a feed name. */
export async function readFeedFile(filename: string): Promise<string | null> {
	if (!isFeedMetadataName(filename)) {
		return null;
	}
	const path = resolveReleaseArtifactPath(filename);
	if (path === null) {
		return null;
	}
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

/**
 * Absolute path of an artifact the published metadata references, or `null`.
 *
 * Two gates: the name must have no path component of its own, and it must appear in a yml in the
 * releases root. Containment inside that root is re-checked by `resolveReleaseArtifactPath`.
 */
export async function resolveServableArtifact(
	filename: string,
): Promise<string | null> {
	if (basename(filename) !== filename) {
		return null;
	}
	const index = await readFeedIndex();
	if (!index.has(filename)) {
		return null;
	}
	return resolveReleaseArtifactPath(filename);
}
