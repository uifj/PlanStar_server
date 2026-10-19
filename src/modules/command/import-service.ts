import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import * as Y from "yjs";
import { ensureSpaceAccess } from "../../auth/space-access.js";
import type { AuthUser } from "../../lib/auth.js";
import { storeDocument } from "../collab/server.js";
import { createObject } from "./object-service.js";
import type { CommandBody } from "./schema.js";
import { isStagedPath } from "./staged-path.js";

// I.ImportType (front_web interface/common.ts:126). Markdown and Obsidian both ride
// markdownParams, so one reader covers both; Html and Text carry their own params object.
const IMPORT_MARKDOWN = 1;
const IMPORT_HTML = 4;
const IMPORT_TEXT = 5;
const IMPORT_OBSIDIAN = 7;

// Three failure kinds, mapped by the command case onto the transport codes the client reads:
// a path the ingress could not have produced is an access denial, an unsupported type is a
// capability the shim does not claim, and anything else is a bad request.
export class ImportPathError extends Error {}
export class ImportUnsupportedError extends Error {}
export class ImportError extends Error {}

function assertStaged(path: string) {
	if (!isStagedPath(path)) {
		throw new ImportPathError(
			"Import path is outside the upload staging directory.",
		);
	}
	return path;
}

async function readStaged(paths: unknown) {
	const list = Array.isArray(paths)
		? paths
		: typeof paths === "string" && paths
			? [paths]
			: [];
	const files: Array<{ path: string; text: string }> = [];
	for (const entry of list) {
		if (typeof entry !== "string" || !entry) {
			continue;
		}
		const path = assertStaged(entry);
		try {
			files.push({ path, text: await readFile(path, "utf8") });
		} catch {
			throw new ImportError(`Staged file could not be read: ${path}`);
		}
	}
	if (!files.length) {
		throw new ImportError("ObjectImport needs at least one staged file path.");
	}
	return files;
}

function inline(text: string) {
	return text
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_`~]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

// Markdown → a page name plus its paragraphs. The reader deliberately produces paragraphs
// only: the first heading's text names the page and every other block becomes a paragraph.
// Rebuilding heading levels, lists, tables and code fences would have to match the editor's
// node vocabulary exactly to survive a reload, and ADR-0018 makes that document the source.
export function markdownToPage(text: string) {
	const blocks = text
		.replace(/\r\n/g, "\n")
		.split(/\n{2,}/)
		.map((block) => block.trim())
		.filter((block) => block && !/^[-=]{3,}$/.test(block));

	let name = "";
	const paragraphs: string[] = [];

	blocks.forEach((block, blockIndex) => {
		const lines = block
			.split("\n")
			.map((line) =>
				inline(line.replace(/^\s*#{1,6}\s+/, "").replace(/^\s*[-*+]\s+/, "")),
			)
			.filter(Boolean);

		lines.forEach((line, lineIndex) => {
			if (blockIndex === 0 && lineIndex === 0 && !name) {
				name = line;
				return;
			}
			paragraphs.push(line);
		});
	});

	return { name, paragraphs };
}

const ENTITIES: Record<string, string> = {
	nbsp: " ",
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	"#39": "'",
};

function decodeEntities(text: string) {
	return text.replace(
		/&([a-z0-9#]+);/gi,
		(entity, key: string) => ENTITIES[key.toLowerCase()] ?? " ",
	);
}

function htmlToPage(text: string) {
	// The document head carries metadata and a title that is not body content; the h1 is the
	// page's name and everything after it is the page.
	const body = text
		.replace(/<head[\s\S]*?<\/head>/gi, "")
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "");

	const heading = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
	const name = heading
		? inline(decodeEntities(heading[1].replace(/<[^>]+>/g, "")))
		: "";

	const paragraphs = body
		.replace(/<br\s*\/?>/gi, "\n\n")
		.split(/<\/(?:p|h[1-6]|li|div|blockquote|tr|td)>/i)
		.map((block) => inline(decodeEntities(block.replace(/<[^>]+>/g, " "))))
		.filter((block) => block && block !== name);

	return { name, paragraphs };
}

function textToPage(text: string, path: string) {
	return {
		name: basename(path, extname(path)) || "Untitled",
		paragraphs: text
			.replace(/\r\n/g, "\n")
			.split(/\n{2,}/)
			.map((block) => block.trim())
			.filter(Boolean),
	};
}

// The body as the collab editor stores it: one Y.XmlElement per block node, named after the
// ProseMirror type ("paragraph"), with its inline content in a Y.XmlText child. Bare XmlText
// children in the fragment is what the history *preview* can decode but y-prosemirror cannot
// render, so an imported page would otherwise open as an empty document.
export function paragraphState(paragraphs: string[]) {
	const doc = new Y.Doc();
	const nodes = paragraphs.map((text) => {
		const element = new Y.XmlElement("paragraph");
		element.insert(0, [new Y.XmlText(text)]);
		return element;
	});
	if (nodes.length) {
		doc.getXmlFragment("default").insert(0, nodes);
	}
	const state = Y.encodeStateAsUpdate(doc);
	doc.destroy();
	return state;
}

// ObjectImport for the file-backed types: each staged file becomes a page whose name comes
// from its first heading (its filename for plain text) and whose body is written through the
// canonical body-write path, so snippet, version snapshot and body links stay consistent with
// a page the user edits in the browser.
export async function importFiles(user: AuthUser, body: CommandBody) {
	const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
	if (!spaceId) {
		throw new ImportError("ObjectImport needs a spaceId.");
	}
	// Importing writes objects into the space, so it is a write: the same gate as a collab edit.
	await ensureSpaceAccess(user.id, spaceId, "writer");

	const type = typeof body.type === "number" ? body.type : -1;
	const params =
		type === IMPORT_MARKDOWN || type === IMPORT_OBSIDIAN
			? body.markdownParams
			: type === IMPORT_HTML
				? body.htmlParams
				: type === IMPORT_TEXT
					? body.txtParams
					: undefined;
	if (!params) {
		throw new ImportUnsupportedError(
			`This build imports Markdown, Obsidian, HTML and plain-text files (type ${type}).`,
		);
	}

	const files = await readStaged((params as { path?: unknown }).path);
	const objectIds: string[] = [];

	for (const file of files) {
		const page =
			type === IMPORT_HTML
				? htmlToPage(file.text)
				: type === IMPORT_TEXT
					? textToPage(file.text, file.path)
					: markdownToPage(file.text);
		const name =
			page.name || basename(file.path, extname(file.path)) || "Untitled";
		const paragraphs = page.paragraphs.length ? page.paragraphs : [name];

		const obj = await createObject(user, { spaceId, details: { name } });
		await storeDocument(obj.id, paragraphState(paragraphs), user.id);
		objectIds.push(obj.id);
	}

	return objectIds;
}
