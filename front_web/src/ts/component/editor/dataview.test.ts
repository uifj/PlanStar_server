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

describe('dataview node', () => {
	const editors: Editor[] = [];
	const make = () => {
		const editor = new Editor({ extensions: createBlockExtensions() });
		editors.push(editor);
		return editor;
	};

	afterEach(() => {
		editors.splice(0).forEach((e) => e.destroy());
	});

	const view = () => ({
		type: 'dataview',
		attrs: { targetCollection: [ 'typeA', 'typeB' ], defaultView: 'table' },
	});

	it('registers a block-group dataview node', () => {
		const editor = make();
		expect(editor.schema.nodes.dataview).toBeDefined();
	});

	it('round-trips targetCollection/defaultView to JSON', () => {
		const editor = make();
		editor.chain().insertContent(view()).run();

		const node = findNode(editor.getJSON(), 'dataview');
		expect(node?.attrs?.targetCollection).toEqual([ 'typeA', 'typeB' ]);
		expect(node?.attrs?.defaultView).toBe('table');
	});

	it('renders the dataview placeholder carrying its view', () => {
		const editor = make();
		editor.chain().insertContent(view()).run();

		const html = editor.getHTML();
		expect(html).toContain('data-dataview');
		expect(html).toContain('table');
	});
});
