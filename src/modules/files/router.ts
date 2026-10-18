import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getCurrentUser } from "../../auth/current-user.js";
import { ensureSpaceAccess } from "../../auth/space-access.js";
import { env } from "../../config/env.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuthType } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { sessionMiddleware } from "../../middleware/session.js";
import { readFileBytes } from "./storage.js";

// Serves stored file bytes at the URLs the client builds (store/common.ts): fileUrl →
// `<gateway>/file/<id>`, imageUrl → `<gateway>/image/<id>?width=<N>`. These land straight
// in an <img>/<video>/<audio>/iframe src, so they return raw bytes with the stored content
// type. Image resizing by width is deferred; for now /image serves the same raw bytes.
//
// The router mounts at the API root, so its auth middleware is scoped to the serve and
// staging prefixes rather than "*" — a root-wide guard would swallow every sibling route.
export const filesRouter = new OpenAPIHono<{ Variables: AuthType }>();

filesRouter.use("/file/*", sessionMiddleware, requireAuth);
filesRouter.use("/image/*", sessionMiddleware, requireAuth);
filesRouter.use("/web-upload", sessionMiddleware, requireAuth);

// The browser file dialog stages a picked file's base64 here (lib/web/electronMock.ts), then
// feeds the returned path to FileUpload as localPath. Mirrors the Vite dev middleware so the
// web client uploads identically in production. 100MB matches that middleware's cap.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function sanitizeFilename(filename: string): string {
	return String(filename || "file")
		.replaceAll("\u0000", "_")
		.replace(/[/\\:]/g, "_")
		.replace(/^\.+/, "_");
}

filesRouter.post("/web-upload", async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}

	const { filename, content } = (body ?? {}) as {
		filename?: unknown;
		content?: unknown;
	};
	if (typeof filename !== "string" || typeof content !== "string" || !content) {
		return c.json({ error: "Missing filename or content" }, 400);
	}

	const bytes = Buffer.from(content, "base64");
	if (bytes.byteLength > MAX_UPLOAD_BYTES) {
		return c.json({ error: "File too large" }, 413);
	}

	const root = resolve(env.FILE_UPLOAD_STAGING_ROOT);
	await mkdir(root, { recursive: true });

	const safeName = sanitizeFilename(filename);
	const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
	const path = join(root, uniqueName);
	await writeFile(path, bytes);

	return c.json({ path }, 200);
});

function detailsOf(value: Prisma.JsonValue): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

async function serveStoredFile(
	c: Context<{ Variables: AuthType }>,
	id: string,
) {
	const user = getCurrentUser(c);

	const obj = await prisma.obj.findUnique({ where: { id } });
	if (!obj || obj.isDeleted) {
		return c.notFound();
	}

	try {
		await ensureSpaceAccess(user.id, obj.spaceId, "reader");
	} catch {
		return c.body(null, 403);
	}

	const bytes = await readFileBytes(id);
	if (bytes === null) {
		return c.notFound();
	}

	const mime = detailsOf(obj.details).fileMimeType;
	const contentType =
		typeof mime === "string" && mime ? mime : "application/octet-stream";

	return c.body(bytes as unknown as ArrayBuffer, 200, {
		"Content-Type": contentType,
		"Content-Length": String(bytes.byteLength),
	});
}

filesRouter.get("/file/:id", (c) => serveStoredFile(c, c.req.param("id")));

// The image endpoint serves the same bytes; width bucketing/resizing is a follow-up.
filesRouter.get("/image/:id", (c) => serveStoredFile(c, c.req.param("id")));
