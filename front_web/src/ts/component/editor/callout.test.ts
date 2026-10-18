// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
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

describe('Callout node', () => {
	const editors: Editor[] = [];
	const make = () => {
		const editor = new Editor({ extensions: createBlockExtensions() });
		editors.push(editor);
		return editor;
	};

	afterEach(() => {
		editors.splice(0).forEach((e) => e.destroy());
	});

	const fire = () => ({
		type: 'callout',
		attrs: { icon: '🔥' },
		content: [ { type: 'paragraph', content: [ { type: 'text', text: 'heads up' } ] } ],
	});

	it('registers a block-group callout node', () => {
		const editor = make();
		expect(editor.schema.nodes.callout).toBeDefined();
	});

	it('round-trips the icon attribute and nested block content to JSON', () => {
		const editor = make();
		editor.chain().insertContent(fire()).run();

		const callout = findNode(editor.getJSON(), 'callout');
		expect(callout?.attrs?.icon).toBe('🔥');
		expect(findNode(callout, 'paragraph')).toBeDefined();
		expect(callout.content[0].content[0].text).toBe('heads up');
	});

	it('renders the callout container and its icon to HTML', () => {
		const editor = make();
		editor.chain().insertContent(fire()).run();

		const html = editor.getHTML();
		expect(html).toContain('data-callout');
		expect(html).toContain('callout-icon');
		expect(html).toContain('🔥');
	});
});
