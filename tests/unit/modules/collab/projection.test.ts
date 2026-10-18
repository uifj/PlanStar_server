import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
	bodySnippetFromState,
	bodyTextFromState,
	objectLinkTargetsFromState,
} from "../../../../src/modules/collab/projection.js";

// The body is a Tiptap document persisted as a Yjs update (ADR-0018). Tiptap's
// Collaboration extension writes ProseMirror nodes into the "default" XmlFragment:
// block nodes become XmlElements, their text becomes XmlText children. The projection
// must turn that binary back into plain text so the object kernel can search it.
function tiptapState(blocks: string[][]): Uint8Array {
	const doc = new Y.Doc();
	const fragment = doc.getXmlFragment("default");
	for (const runs of blocks) {
		const paragraph = new Y.XmlElement("paragraph");
		runs.forEach((text, index) => {
			paragraph.insert(index, [new Y.XmlText(text)]);
		});
		fragment.push([paragraph]);
	}
	return Y.encodeStateAsUpdate(doc);
}

describe("bodyTextFromState", () => {
	it("extracts paragraph text from a persisted Yjs update", () => {
		const state = tiptapState([["Hello world"]]);
		expect(bodyTextFromState(state)).toBe("Hello world");
	});

	it("joins inline runs within a block and separates blocks with newlines", () => {
		const doc = new Y.Doc();
		const fragment = doc.getXmlFragment("default");

		const first = new Y.XmlElement("paragraph");
		first.insert(0, [new Y.XmlText("Hello ")]);
		const bold = new Y.XmlElement("bold");
		bold.insert(0, [new Y.XmlText("world")]);
		first.insert(1, [bold]);

		const second = new Y.XmlElement("paragraph");
		second.insert(0, [new Y.XmlText("Second line")]);

		fragment.push([first, second]);

		expect(bodyTextFromState(Y.encodeStateAsUpdate(doc))).toBe(
			"Hello world\nSecond line",
		);
	});

	it("returns an empty string for an empty document", () => {
		const doc = new Y.Doc();
		expect(bodyTextFromState(Y.encodeStateAsUpdate(doc))).toBe("");
	});
});

describe("bodySnippetFromState", () => {
	it("collapses block newlines into a single-line preview", () => {
		const doc = new Y.Doc();
		const fragment = doc.getXmlFragment("default");
		for (const text of ["First line", "Second line"]) {
			const paragraph = new Y.XmlElement("paragraph");
			paragraph.insert(0, [new Y.XmlText(text)]);
			fragment.push([paragraph]);
		}

		expect(bodySnippetFromState(Y.encodeStateAsUpdate(doc))).toBe(
			"First line Second line",
		);
	});

	it("caps the preview length with an ellipsis", () => {
		const doc = new Y.Doc();
		const fragment = doc.getXmlFragment("default");
		const paragraph = new Y.XmlElement("paragraph");
		paragraph.insert(0, [new Y.XmlText("a".repeat(400))]);
		fragment.push([paragraph]);

		const snippet = bodySnippetFromState(Y.encodeStateAsUpdate(doc), 100);
		expect(snippet).toBe(`${"a".repeat(99)}…`);
		expect(snippet.length).toBe(100);
	});

	it("returns an empty snippet for an empty document", () => {
		const doc = new Y.Doc();
		expect(bodySnippetFromState(Y.encodeStateAsUpdate(doc))).toBe("");
	});
});

// An objectLink node is serialized by y-tiptap as `new Y.XmlElement("objectLink")`
// carrying its targetObjectId as a plain XML attribute, nested inside the containing
// block. The projection reads those references back out so storeDocument can turn the
// body's in-text mentions into graph edges (ADR-0013's page edge).
describe("objectLinkTargetsFromState", () => {
	type Run = string | { target: string };

	function bodyWithRuns(paragraphs: Run[][]): Uint8Array {
		const doc = new Y.Doc();
		const fragment = doc.getXmlFragment("default");
		for (const runs of paragraphs) {
			const paragraph = new Y.XmlElement("paragraph");
			runs.forEach((run, index) => {
				if (typeof run === "string") {
					paragraph.insert(index, [new Y.XmlText(run)]);
					return;
				}
				const link = new Y.XmlElement("objectLink");
				link.setAttribute("targetObjectId", run.target);
				paragraph.insert(index, [link]);
			});
			fragment.push([paragraph]);
		}
		return Y.encodeStateAsUpdate(doc);
	}

	it("collects objectLink targets from nested blocks, de-duplicated", () => {
		const state = bodyWithRuns([
			["see ", { target: "objA" }, " and ", { target: "objB" }],
			[{ target: "objA" }, " again"],
		]);
		expect(objectLinkTargetsFromState(state).sort()).toEqual(["objA", "objB"]);
	});

	it("returns no targets for a body without object links", () => {
		const state = bodyWithRuns([["plain text"]]);
		expect(objectLinkTargetsFromState(state)).toEqual([]);
	});

	it("ignores an object link with no target id set", () => {
		const doc = new Y.Doc();
		const fragment = doc.getXmlFragment("default");
		const paragraph = new Y.XmlElement("paragraph");
		const link = new Y.XmlElement("objectLink");
		paragraph.insert(0, [link]);
		fragment.push([paragraph]);

		expect(objectLinkTargetsFromState(Y.encodeStateAsUpdate(doc))).toEqual([]);
	});
});
