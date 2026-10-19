import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ensureSpaceAccess } from "../../auth/space-access.js";
import { API_PREFIX } from "../../config/constants.js";
import { env } from "../../config/env.js";
import type { AuthUser } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { bodyTextFromState } from "../collab/projection.js";
import { buildZip, type ZipEntry } from "../files/zip.js";
import { ImportError, ImportUnsupportedError } from "./import-service.js";
import type { CommandBody } from "./schema.js";

// I.ExportType (front_web interface/common.ts:205). Only these two are a plain read of objects
// this server holds; Protobuf, Dot, Svg, GraphJson and AnyBlockV2 need their own serialisers.
const EXPORT_MARKDOWN = 0;
const EXPORT_JSON = 2;

const MAX_NAME_LENGTH = 120;

// A zip entry name from an object title: separators, the reserved Windows set and control
// characters go, and an empty result still yields a usable file name.
function entryName(title: string, extension: string) {
	const cleaned =
		title
			.replace(/[/\\:*?"<>|\p{Cc}]/gu, "_")
			.replace(/^\.+/, "")
			.trim()
			.slice(0, MAX_NAME_LENGTH) || "untitled";
	return `${cleaned}.${extension}`;
}

function uniqueName(candidate: string, used: Set<string>) {
	let name = candidate;
	let index = 2;
	while (used.has(name.toLowerCase())) {
		const dot = candidate.lastIndexOf(".");
		name = `${candidate.slice(0, dot)}-${index}.${candidate.slice(dot + 1)}`;
		index += 1;
	}
	used.add(name.toLowerCase());
	return name;
}

// The name the download is served under. Entries inside the archive keep the readable title;
// this one has to survive a URL and the export route's name pattern, so anything else becomes
// an underscore rather than a percent-encoding the client then has to reproduce.
function safeFileName(name: string) {
	return name.replace(/[^A-Za-z0-9._-]/g, "_");
}

// ObjectListExport for the Markdown and JSON formats. A browser cannot hand the server a
// directory — the desktop flow picks one — so the archive is written under this server's export
// root and answered as a download URL the client's own download path opens.
export async function exportObjects(user: AuthUser, body: CommandBody) {
	const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
	if (!spaceId) {
		throw new ImportError(
			"ObjectListExport needs the space whose objects are exported.",
		);
	}

	const format = typeof body.format === "number" ? body.format : -1;
	if (format !== EXPORT_MARKDOWN && format !== EXPORT_JSON) {
		throw new ImportUnsupportedError(
			`This build exports Markdown and JSON (format ${format}).`,
		);
	}

	// Export reads the space; a reader may back their own work up.
	await ensureSpaceAccess(user.id, spaceId, "reader");

	const requested = Array.isArray(body.objectIds)
		? body.objectIds.filter(
				(it): it is string => typeof it === "string" && !!it,
			)
		: [];
	const includeArchived = body.includeArchived === true;
	const where = {
		spaceId,
		isDeleted: false,
		...(includeArchived ? {} : { isArchived: false }),
		...(requested.length ? { id: { in: requested } } : {}),
	};

	const rows = await prisma.obj.findMany({
		where,
		orderBy: { createdAt: "asc" },
	});
	if (!rows.length) {
		throw new ImportError("ObjectListExport found no object to export.");
	}

	const states = await prisma.documentState.findMany({
		where: { objectId: { in: rows.map((row) => row.id) } },
		select: { objectId: true, state: true },
	});
	const bodies = new Map(
		states.map((row) => [
			row.objectId,
			bodyTextFromState(new Uint8Array(row.state)),
		]),
	);

	const used = new Set<string>();
	const extension = format === EXPORT_JSON ? "json" : "md";
	const entries: ZipEntry[] = [];
	for (const row of rows) {
		const title = row.name || "Untitled";
		const details =
			row.details &&
			typeof row.details === "object" &&
			!Array.isArray(row.details)
				? (row.details as Record<string, unknown>)
				: {};
		const text = bodies.get(row.id) ?? "";
		const content =
			format === EXPORT_JSON
				? JSON.stringify(
						{ id: row.id, details: { ...details, name: title }, body: text },
						null,
						2,
					)
				: `# ${title}\n\n${text}\n`;
		entries.push({
			name: uniqueName(entryName(title, extension), used),
			bytes: Uint8Array.from(new TextEncoder().encode(content)),
		});
	}

	const zip = body.zip === true || entries.length > 1;
	const filename = safeFileName(
		zip ? `${spaceId.slice(0, 12)}.zip` : entries[0].name,
	);
	const bytes = zip ? buildZip(entries) : entries[0].bytes;

	const root = resolve(env.EXPORT_ROOT);
	await mkdir(root, { recursive: true });
	const stored = `${Date.now()}-${Math.random().toString(36).slice(2)}-${filename}`;
	await writeFile(join(root, stored), bytes);

	return {
		path: `${env.APP_URL}${API_PREFIX}/export/${stored}`,
		filename,
		report: {
			objectCount: rows.length,
			// An id that is deleted, or belongs to another space, is reported rather than
			// quietly dropped, so the client's Partial status can surface it.
			objectErrors: Math.max(0, requested.length - rows.length),
			fileErrors: 0,
			issues: [],
		},
	};
}
