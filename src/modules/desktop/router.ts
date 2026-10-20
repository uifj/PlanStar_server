import { readFile } from "node:fs/promises";
import { OpenAPIHono } from "@hono/zod-openapi";
import { NotFoundError } from "../../errors/http-errors.js";
import { DESKTOP_MANIFEST_CONTENT_TYPE } from "./constants.js";
import {
	downloadReleaseArtifactRoute,
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

desktopRouter.openapi(downloadReleaseArtifactRoute, async (c) => {
	const { filename } = c.req.valid("param");
	const path = service.resolveReleaseArtifactPath(filename);
	if (path === null) {
		throw new NotFoundError("Artifact not found.");
	}
	try {
		const bytes = await readFile(path);
		return c.body(new Uint8Array(bytes), 200, {
			"Content-Type": "application/octet-stream",
		});
	} catch {
		throw new NotFoundError("Artifact not found.");
	}
});
