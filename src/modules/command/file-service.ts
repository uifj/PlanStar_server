import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ensureSpaceAccess } from "../../auth/space-access.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuthUser } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { writeFileBytes } from "../files/storage.js";
import { ensureAccount } from "./account-service.js";
import type { CommandBody } from "./schema.js";

// The Prisma ObjectLayout value a mime type maps onto (front_web interface/object.ts:
// File = 6, Image = 8, Audio = 15, Video = 16, Pdf = 20). Anything else is a plain file.
type FileLayout = "image" | "video" | "audio" | "pdf" | "file";
function layoutForMime(mime: string): FileLayout {
	if (mime.startsWith("image/")) return "image";
	if (mime.startsWith("video/")) return "video";
	if (mime.startsWith("audio/")) return "audio";
	if (mime === "application/pdf") return "pdf";
	return "file";
}

const MIME_BY_EXT: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	avif: "image/avif",
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	m4a: "audio/mp4",
	pdf: "application/pdf",
	txt: "text/plain",
	json: "application/json",
};

function mimeForExt(ext: string): string {
	return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function detailsOf(body: CommandBody): Record<string, unknown> {
	const details = body.details;
	return details && typeof details === "object"
		? (details as Record<string, unknown>)
		: {};
}

// Reads the bytes to store: a server-side path first (the web transport stages a picked
// file to /api/web-upload and hands back its path), else an http(s) url fetched remotely.
async function readSourceBytes(body: CommandBody): Promise<Uint8Array | null> {
	const localPath =
		typeof body.localPath === "string" && body.localPath ? body.localPath : "";
	if (localPath) {
		try {
			return await readFile(localPath);
		} catch {
			return null;
		}
	}

	const url = typeof body.url === "string" && body.url ? body.url : "";
	if (url && /^https?:\/\//.test(url)) {
		try {
			const response = await fetch(url);
			if (!response.ok) return null;
			return new Uint8Array(await response.arrayBuffer());
		} catch {
			return null;
		}
	}

	return null;
}

// A name for the file object: an explicit details.name wins, else the basename of the
// path/url the bytes came from.
function nameFor(body: CommandBody): string {
	const details = detailsOf(body);
	if (typeof details.name === "string" && details.name) {
		return details.name;
	}
	const localPath = typeof body.localPath === "string" ? body.localPath : "";
	if (localPath) return basename(localPath);
	const url = typeof body.url === "string" ? body.url : "";
	if (url) {
		try {
			const last = basename(new URL(url).pathname);
			if (last) return last;
		} catch {
			// fall through
		}
	}
	return "file";
}

// FileUpload is the web file ingress (command.ts:289, popup/upload.tsx). It mints a file
// object — layout by content mime, metadata in the details JSONB (ADR-0002) — writes the
// bytes to the local store keyed by that object's id, and (for an icon/cover picker)
// points the createdInContext object's createdInContextRef detail at the new file. Returns
// { objectId, details } the client reads as message.objectId.
export async function uploadFile(user: AuthUser, body: CommandBody) {
	const account = await ensureAccount(user);
	const spaceId =
		typeof body.spaceId === "string" && body.spaceId
			? body.spaceId
			: account.spaceId;
	await ensureSpaceAccess(user.id, spaceId, "writer");

	const bytes = await readSourceBytes(body);
	if (bytes === null) {
		return null;
	}

	const name = nameFor(body);
	const dot = name.lastIndexOf(".");
	const fileExt = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
	const fileMimeType = mimeForExt(fileExt);
	const layout = layoutForMime(fileMimeType);

	const custom = detailsOf(body);
	const persisted: Record<string, unknown> = {
		...custom,
		name,
		fileExt,
		fileMimeType,
		sizeInBytes: bytes.length,
	};

	const obj = await prisma.obj.create({
		data: {
			spaceId,
			name,
			resolvedLayout: layout,
			layout,
			details: persisted as Prisma.InputJsonObject,
			creatorId: user.id,
		},
	});

	await writeFileBytes(obj.id, bytes);

	// An icon/cover picker passes createdInContext (the object being decorated) and
	// createdInContextRef ('iconImage' / 'coverId'); write the new file id onto it so the
	// decoration sticks without a second round-trip.
	const contextId =
		typeof body.createdInContext === "string" ? body.createdInContext : "";
	const contextRef =
		typeof body.createdInContextRef === "string"
			? body.createdInContextRef
			: "";
	if (contextId && contextRef) {
		const context = await prisma.obj.findUnique({ where: { id: contextId } });
		if (context) {
			const contextDetails =
				context.details &&
				typeof context.details === "object" &&
				!Array.isArray(context.details)
					? (context.details as Record<string, unknown>)
					: {};
			await prisma.obj.update({
				where: { id: contextId },
				data: {
					details: {
						...contextDetails,
						[contextRef]: obj.id,
					} as Prisma.InputJsonObject,
				},
			});
		}
	}

	return { objectId: obj.id, details: persisted };
}

// Stores already-fetched image bytes (a bookmark's og:image or favicon) as a file object in the
// given space and returns its id, so the bookmark can point details.picture / details.iconImage at
// it and the client renders it through the media gateway (imageUrl(id) -> GET /api/image/:id). The
// bytes are fetched by the caller through the SSRF guard (link-preview-service fetchPreviewImage);
// this only persists them, mirroring uploadFile's object shape. The mime is the server's
// content-type when it declares an image, else derived from the url's extension.
export async function storeImageFile(
	spaceId: string,
	creatorId: string,
	source: { url: string; bytes: Uint8Array; contentType: string },
): Promise<string> {
	let name = "image";
	try {
		const last = basename(new URL(source.url).pathname);
		if (last) name = last;
	} catch {
		// fall through to the default name
	}

	const dot = name.lastIndexOf(".");
	const fileExt = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
	const fileMimeType = source.contentType.startsWith("image/")
		? source.contentType
		: mimeForExt(fileExt);
	const layout = layoutForMime(fileMimeType);

	const obj = await prisma.obj.create({
		data: {
			spaceId,
			name,
			resolvedLayout: layout,
			layout,
			details: {
				name,
				fileExt,
				fileMimeType,
				sizeInBytes: source.bytes.length,
			} as Prisma.InputJsonObject,
			creatorId,
		},
	});

	await writeFileBytes(obj.id, source.bytes);

	return obj.id;
}
