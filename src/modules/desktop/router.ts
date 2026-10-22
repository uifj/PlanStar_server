import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { NotFoundError } from "../../errors/http-errors.js";
import { desktopLogsRouter } from "../desktop-logs/router.js";
import { DESKTOP_MANIFEST_CONTENT_TYPE } from "./constants.js";
import {
	isFeedMetadataName,
	readFeedFile,
	resolveServableArtifact,
} from "./feed.js";
import {
	downloadReleaseArtifactRoute,
	getReleaseFeedFileRoute,
	getReleaseManifestRoute,
	submitCrashReportRoute,
	submitFeedbackRoute,
} from "./routes.js";
import * as service from "./service.js";

/**
 * Desktop-shell router, mounted at `/api/desktop`.
 *
 * Plain (unauthenticated) by design: the manifest is fetched before login, a crash dump arrives with
 * no valid session, and feedback must succeed even when signed out. Intake is write-only to an
 * id-keyed directory, so there is no data to authorize against — the same posture as the file
 * store's public serve route.
 */
export const desktopRouter = new OpenAPIHono();

desktopRouter.openapi(submitFeedbackRoute, async (c) => {
	const payload = c.req.valid("json");
	const result = await service.submitFeedback(payload);
	return c.json(result, 201);
});

desktopRouter.openapi(submitCrashReportRoute, async (c) => {
	// The body is a minidump (multipart or raw); store it verbatim rather than parsing it.
	const buffer = await c.req.arrayBuffer();
	const meta = {
		platform: c.req.header("X-Platform") ?? c.req.query("platform") ?? "",
		channel: c.req.header("X-Release-Channel") ?? c.req.query("channel") ?? "",
		contentType: c.req.header("Content-Type") ?? "",
	};
	const result = await service.submitCrashReport(new Uint8Array(buffer), meta);
	return c.json(result, 202);
});

desktopRouter.openapi(getReleaseManifestRoute, (c) => {
	const query = c.req.valid("query");
	const yaml = service.getReleaseManifest(query);
	if (yaml === null) {
		throw new NotFoundError("No release published for this platform/channel.");
	}
	return c.body(yaml, 200, { "Content-Type": DESKTOP_MANIFEST_CONTENT_TYPE });
});

/**
 * Stream an artifact rather than buffering it. A macOS update zip is ~150 MB, so `readFile` here
 * would spike the API's heap for every download.
 */
async function openArtifact(
	path: string,
): Promise<{ stream: ReadableStream; size: number }> {
	const { size } = await stat(path);
	return {
		stream: Readable.toWeb(createReadStream(path)) as ReadableStream,
		size,
	};
}

function artifactResponse(
	c: Context,
	body: { stream: ReadableStream; size: number },
): Response {
	return c.body(body.stream, 200, {
		"Content-Type": "application/zip",
		"Content-Length": String(body.size),
		"Cache-Control": "public, max-age=300",
	});
}

desktopRouter.openapi(downloadReleaseArtifactRoute, async (c) => {
	const { filename } = c.req.valid("param");
	const path = await resolveServableArtifact(filename);
	if (path === null) {
		throw new NotFoundError("Artifact not found.");
	}
	try {
		return artifactResponse(c, await openArtifact(path));
	} catch {
		throw new NotFoundError("Artifact not found.");
	}
});

/**
 * The updater's single feed URL serves two shapes: the builder metadata (`latest-mac.yml`) and the
 * archive that metadata names. Dispatch on the name; both branches are allowlisted.
 */
desktopRouter.openapi(getReleaseFeedFileRoute, async (c) => {
	const { filename } = c.req.valid("param");

	if (isFeedMetadataName(filename)) {
		const yaml = await readFeedFile(filename);
		if (yaml === null) {
			throw new NotFoundError("Feed metadata not found.");
		}
		return c.body(yaml, 200, { "Content-Type": DESKTOP_MANIFEST_CONTENT_TYPE });
	}

	const path = await resolveServableArtifact(filename);
	if (path === null) {
		throw new NotFoundError("Release artifact not found.");
	}
	try {
		return artifactResponse(c, await openArtifact(path));
	} catch {
		throw new NotFoundError("Release artifact not found.");
	}
});

// Log uplink (anonymous write, operator-only read) lives in its own module but shares the desktop
// auth posture: nothing here needs a session, and the shell may be reporting a crash at boot.
desktopRouter.route("/", desktopLogsRouter);
