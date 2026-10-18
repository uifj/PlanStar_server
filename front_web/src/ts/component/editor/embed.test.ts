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

describe('embed node', () => {
	const editors: Editor[] = [];
	const make = () => {
		const editor = new Editor({ extensions: createBlockExtensions() });
		editors.push(editor);
		return editor;
	};

	afterEach(() => {
		editors.splice(0).forEach((e) => e.destroy());
	});

	const clip = () => ({
		type: 'embed',
		attrs: { src: 'https://example.com/embed/1', caption: 'A talk' },
	});

	it('registers a block-group embed node', () => {
		const editor = make();
		expect(editor.schema.nodes.embed).toBeDefined();
	});

	it('round-trips src/caption to JSON', () => {
		const editor = make();
		editor.chain().insertContent(clip()).run();

		const node = findNode(editor.getJSON(), 'embed');
		expect(node?.attrs?.src).toBe('https://example.com/embed/1');
		expect(node?.attrs?.caption).toBe('A talk');
	});

	it('renders the embed exposing its source URL', () => {
		const editor = make();
		editor.chain().insertContent(clip()).run();

		const html = editor.getHTML();
		expect(html).toContain('data-embed');
		expect(html).toContain('https://example.com/embed/1');
	});
});
