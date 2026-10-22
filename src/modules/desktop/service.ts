import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { FORCED_TRUTHY } from "./constants.js";
import type {
	FeedbackIntake,
	IntakeAccepted,
	ReleaseManifestQuery,
} from "./schema.js";

/**
 * Desktop intake + release service.
 *
 * Persistence is deliberately filesystem-based (under `DESKTOP_DATA_ROOT`), mirroring the file
 * store: a self-hosted deployment keeps feedback and crash dumps on disk with no extra infra, and
 * each artifact is keyed by a UUID so there is no collision or traversal risk. Nothing here touches
 * Prisma — intake must keep working even when the database is down (a crashing shell has no session
 * and a feedback dialog should not 500 because the DB blipped).
 */

function intakeDir(kind: "feedback" | "crash"): string {
	return resolve(join(env.DESKTOP_DATA_ROOT, kind));
}

async function writeArtifact(
	kind: "feedback" | "crash",
	id: string,
	ext: string,
	contents: Uint8Array | string,
): Promise<void> {
	const dir = intakeDir(kind);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, `${id}.${ext}`), contents as Uint8Array);
}

/**
 * Persist a feedback submission and return its intake id. The shell keeps the screenshot locally;
 * only the text + context arrives here, so the record is small and safe to store verbatim.
 */
export async function submitFeedback(
	payload: FeedbackIntake,
): Promise<IntakeAccepted> {
	const id = randomUUID();
	const record = {
		id,
		receivedAt: new Date().toISOString(),
		...payload,
	};
	await writeArtifact("feedback", id, "json", JSON.stringify(record, null, 2));
	logger.info({ desktopFeedbackId: id }, "desktop feedback intake");
	return { received: true, id };
}

/**
 * Persist a crash dump exactly as uploaded. Electron's `crashReporter` posts multipart/form-data
 * with the minidump plus annotations; we store the raw bytes verbatim (so an external breakpad
 * symbolicator can still read them) alongside a JSON sidecar of the transport metadata we could see.
 */
export async function submitCrashReport(
	bytes: Uint8Array,
	meta: Record<string, string>,
): Promise<IntakeAccepted> {
	const id = randomUUID();
	await writeArtifact("crash", id, "dmp", bytes);
	await writeArtifact(
		"crash",
		id,
		"json",
		JSON.stringify(
			{
				id,
				receivedAt: new Date().toISOString(),
				size: bytes.byteLength,
				...meta,
			},
			null,
			2,
		),
	);
	logger.warn(
		{ desktopCrashId: id, bytes: bytes.byteLength },
		"desktop crash report intake",
	);
	return { received: true, id };
}

/**
 * Render the release manifest as flat YAML, or `null` when no version is published. The shell's
 * `parseManifestYaml` requires `version` and treats `path` as optional; everything else is
 * optional. A `null` result becomes a 404 at the route, which the manifest provider surfaces as
 * update-not-available.
 */
export function getReleaseManifest(
	_query: ReleaseManifestQuery,
): string | null {
	const version = env.DESKTOP_RELEASE_VERSION;
	if (!version) {
		return null;
	}

	const forced = FORCED_TRUTHY.has(env.DESKTOP_RELEASE_FORCED.toLowerCase());
	const lines: string[] = [`version: ${version}`];

	// `path` only exists when an artifact was staged. The download URL comes from the builder feed,
	// so a metadata-only release (policy entry without a binary) is valid.
	if (env.DESKTOP_RELEASE_PATH) {
		lines.push(`path: ${env.DESKTOP_RELEASE_PATH}`);
	}

	if (env.DESKTOP_RELEASE_DATE) {
		lines.push(`releaseDate: '${env.DESKTOP_RELEASE_DATE}'`);
	}
	if (env.DESKTOP_RELEASE_SHA512) {
		lines.push(`sha512: ${env.DESKTOP_RELEASE_SHA512}`);
	}
	lines.push(`is_forced: ${forced}`);
	if (env.DESKTOP_RELEASE_NOTES) {
		lines.push("releaseNotes: |");
		for (const noteLine of env.DESKTOP_RELEASE_NOTES.split(/\r?\n/)) {
			lines.push(`  ${noteLine}`);
		}
	}

	return `${lines.join("\n")}\n`;
}

/**
 * Absolute path of a staged release artifact, or `null` when the filename escapes the root.
 *
 * The feed route and the legacy `/releases/download/{filename}` route both funnel through here; the
 * caller is responsible for deciding *whether* a name may be served (see `feed.ts`).
 */
export function resolveReleaseArtifactPath(filename: string): string | null {
	const root = resolve(join(env.DESKTOP_DATA_ROOT, "releases"));
	const candidate = resolve(join(root, filename));
	if (candidate === root || !candidate.startsWith(`${root}/`)) {
		return null;
	}
	return candidate;
}
