import * as Y from "yjs";
import { ensureSpaceAccess } from "../../auth/space-access.js";
import { API_PREFIX } from "../../config/constants.js";
import { env } from "../../config/env.js";
import type { AuthUser } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { storeDocument } from "../collab/server.js";
import { uploadFile } from "./file-service.js";
import {
	ImportError,
	ImportPathError,
	ImportUnsupportedError,
} from "./import-service.js";
import { numericLayout } from "./registry-service.js";
import type { CommandBody } from "./schema.js";
import { isStagedPath, stagedFileName } from "./staged-path.js";

// I.ObjectLayout values a file cannot be dropped onto (front_web interface/object.ts): those
// screens show a query, not a document, so "where does this file go" has no answer here.
const LAYOUT_SET = 3;
const LAYOUT_TYPE = 4;
const LAYOUT_COLLECTION = 14;

type Attachment = { url: string; filename: string; size: number };

// Append one `attachment` atom per dropped file to the end of the stored body. The node is the
// editor's own (component/editor/attachment.ts: name "attachment", attrs url/filename/size), and
// attrs are written with setAttribute exactly the way y-tiptap serialises a node's attrs, so the
// block survives a reload instead of being discarded as an unknown node.
export function appendAttachmentNodes(
	existing: Uint8Array | null,
	attachments: Attachment[],
): Uint8Array {
	const doc = new Y.Doc();
	if (existing) {
		Y.applyUpdate(doc, existing);
	}
	const fragment = doc.getXmlFragment("default");
	const nodes = attachments.map((attachment) => {
		const element = new Y.XmlElement("attachment");
		element.setAttribute("url", attachment.url);
		element.setAttribute("filename", attachment.filename);
		element.setAttribute("size", String(attachment.size));
		return element;
	});
	if (nodes.length) {
		fragment.insert(fragment.length, nodes);
	}
	const state = Y.encodeStateAsUpdate(doc);
	doc.destroy();
	return state;
}

// FileDrop: the drag-and-drop ingress. The browser has already put the bytes on this server
// (the web upload ingress stages them and returns the path), so the command makes a file
// object of each path and hangs it off the page that was dropped on. The client only reads
// error.code — the new objects reach open lists through the same subscription reevaluate a
// create uses.
export async function dropFiles(user: AuthUser, body: CommandBody) {
	const contextId = typeof body.contextId === "string" ? body.contextId : "";
	if (!contextId) {
		throw new ImportError(
			"FileDrop needs the object the files were dropped on.",
		);
	}

	const context = await prisma.obj.findUnique({ where: { id: contextId } });
	if (!context || context.isDeleted) {
		throw new ImportError("FileDrop target object not found.");
	}

	// The object's own space decides access — body.spaceId is the client's current space and
	// cannot be trusted to be the same one.
	await ensureSpaceAccess(user.id, context.spaceId, "writer");

	if (
		numericLayout(context) === LAYOUT_SET ||
		numericLayout(context) === LAYOUT_TYPE ||
		numericLayout(context) === LAYOUT_COLLECTION
	) {
		throw new ImportUnsupportedError(
			"FileDrop attaches files to a page body, not to a set view.",
		);
	}

	const paths = Array.isArray(body.localFilePaths)
		? body.localFilePaths.filter(
				(it): it is string => typeof it === "string" && !!it,
			)
		: [];
	if (!paths.length) {
		throw new ImportError("FileDrop needs at least one staged file path.");
	}
	for (const path of paths) {
		if (!isStagedPath(path)) {
			throw new ImportPathError(
				"FileDrop path is outside the upload staging directory.",
			);
		}
	}

	const stored = await prisma.documentState.findUnique({
		where: { objectId: context.id },
	});
	const previous = stored ? new Uint8Array(stored.state) : null;

	const objectIds: string[] = [];
	const attachments: Attachment[] = [];

	for (const path of paths) {
		const filename = stagedFileName(path);
		const uploaded = await uploadFile(user, {
			spaceId: context.spaceId,
			localPath: path,
			details: { name: filename },
		});
		if (!uploaded) {
			throw new ImportError(`Staged file could not be read: ${path}`);
		}

		objectIds.push(uploaded.objectId);
		attachments.push({
			url: `${env.APP_URL}${API_PREFIX}/file/${uploaded.objectId}`,
			filename,
			size: Number(
				(uploaded.details as Record<string, unknown>).sizeInBytes ?? 0,
			),
		});
	}

	await storeDocument(
		context.id,
		appendAttachmentNodes(previous, attachments),
		user.id,
	);

	// The space is the one the object row lives in, not the client's body.spaceId: the caller's
	// current space is whatever the shell happens to have selected.
	return { objectIds, spaceId: context.spaceId };
}
