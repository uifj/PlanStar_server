import * as Y from "yjs";

// Tiptap's Collaboration extension binds ProseMirror to the "default" XmlFragment:
// block nodes become XmlElements and their inline content becomes XmlText children.
// ADR-0018 makes search text a rebuildable projection of that document, so decoding
// the persisted update back into plain text is what lets the object kernel index a
// body that was authored over the collab socket rather than through block commands.
function collectText(node: Y.XmlElement, out: string[]) {
	node.forEach((child) => {
		if (child instanceof Y.XmlText) {
			out.push(child.toString());
		} else if (child instanceof Y.XmlElement) {
			collectText(child, out);
		}
	});
}

export function bodyTextFromState(state: Uint8Array): string {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, state);

	const lines: string[] = [];
	doc.getXmlFragment("default").forEach((child) => {
		if (child instanceof Y.XmlText) {
			lines.push(child.toString());
			return;
		}
		if (child instanceof Y.XmlElement) {
			const out: string[] = [];
			collectText(child, out);
			lines.push(out.join(""));
		}
	});

	return lines.join("\n").trim();
}

// The version preview and the version diff have to agree on which line is which block. The
// client resolves every HistoryDiffVersions event through `#block-<id>` in the tree it was
// handed by HistoryShowVersion, and reads a changed line's old text from the same id in the
// previous version's context (dispatcher.onObjectView roots that context at
// `<objectId>-<versionId>`). So a preview block id is the line's ordinal: an id that also
// carries the version can never match across the pair being diffed.
export function bodyLineId(objectId: string, ordinal: number): string {
	return `${objectId}-body-${ordinal}`;
}

// A stored snapshot projected into the paragraphs the version preview renders. Blank lines own
// no block, so the preview and the diff count ordinals over this same list.
export function versionBodyLines(state: Uint8Array): string[] {
	return bodyTextFromState(state)
		.split("\n")
		.filter((line) => line !== "");
}

// y-tiptap serializes a ProseMirror node as `new Y.XmlElement(node.type.name)` with its
// non-null attrs written straight onto the element (setAttribute(key, value)). An inline
// objectLink therefore appears as an "objectLink" element carrying a targetObjectId
// attribute at whatever depth its block sits. Walking every element lets the body's
// in-text mentions be read back out as reference targets.
function collectObjectLinkTargets(node: Y.XmlElement, out: Set<string>) {
	node.forEach((child) => {
		if (!(child instanceof Y.XmlElement)) {
			return;
		}
		if (child.nodeName === "objectLink") {
			const target = child.getAttribute("targetObjectId");
			if (typeof target === "string" && target) {
				out.add(target);
			}
		}
		collectObjectLinkTargets(child, out);
	});
}

export function objectLinkTargetsFromState(state: Uint8Array): string[] {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, state);

	const targets = new Set<string>();
	doc.getXmlFragment("default").forEach((child) => {
		if (child instanceof Y.XmlElement) {
			collectObjectLinkTargets(child, targets);
		}
	});

	return [...targets];
}

export const SNIPPET_MAX_LENGTH = 200;

// The snippet is the single-line body preview the object kernel stores beside the
// metadata (Obj.snippet) so search results and object cards can show it without
// decoding the Yjs document on every read.
export function bodySnippetFromState(
	state: Uint8Array,
	maxLength = SNIPPET_MAX_LENGTH,
): string {
	const collapsed = bodyTextFromState(state).replace(/\s+/g, " ").trim();
	if (collapsed.length <= maxLength) {
		return collapsed;
	}
	return `${collapsed.slice(0, maxLength - 1)}…`;
}
