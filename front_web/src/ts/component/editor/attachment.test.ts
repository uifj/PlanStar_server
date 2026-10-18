// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import { createBlockExtensions } from './editorExtensions';

const findNode = (node: any, type: string): any => {
	if (!node || typeof node !== 'object') { return undefined; }
	if (node.type === type) { return node; }
	if (Array.isArray(node.content)) {
		for (const child of node.content) {
			const found = findNode(child, type);
			if (found) { return found; }
		}
	}
	return undefined;
};

describe('attachment node', () => {
	const editors: Editor[] = [];
	const make = () => {
		const editor = new Editor({ extensions: createBlockExtensions() });
		editors.push(editor);
		return editor;
	};

	afterEach(() => {
		editors.splice(0).forEach((e) => e.destroy());
	});

	const file = () => ({
		type: 'attachment',
		attrs: { url: '/file/abc123', filename: 'spec.pdf', size: 2048 },
	});

	it('registers a block-group attachment node', () => {
		const editor = make();
		expect(editor.schema.nodes.attachment).toBeDefined();
	});

	it('round-trips url/filename/size to JSON', () => {
		const editor = make();
		editor.chain().insertContent(file()).run();

		const node = findNode(editor.getJSON(), 'attachment');
		expect(node?.attrs?.url).toBe('/file/abc123');
		expect(node?.attrs?.filename).toBe('spec.pdf');
		expect(node?.attrs?.size).toBe(2048);
	});

	it('renders the attachment as a download link carrying its filename', () => {
		const editor = make();
		editor.chain().insertContent(file()).run();

		const html = editor.getHTML();
		expect(html).toContain('href="/file/abc123"');
		expect(html).toContain('spec.pdf');
	});
});
