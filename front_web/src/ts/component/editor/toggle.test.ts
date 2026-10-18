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

const toggleWith = (open: boolean) => ({
	type: 'toggle',
	attrs: { open },
	content: [
		{ type: 'toggleHeader', content: [ { type: 'text', text: 'Q1' } ] },
		{ type: 'toggleBody', content: [ { type: 'paragraph', content: [ { type: 'text', text: 'answer' } ] } ] },
	],
});

describe('Toggle node', () => {
	const editors: Editor[] = [];
	const make = () => {
		const editor = new Editor({ extensions: createBlockExtensions() });
		editors.push(editor);
		return editor;
	};

	const togglePos = (editor: Editor): number => {
		let pos = -1;
		editor.state.doc.forEach((node, offset) => {
			if (node.type.name === 'toggle') {
				pos = offset;
			}
		});
		return pos;
	};

	afterEach(() => {
		editors.splice(0).forEach((e) => e.destroy());
	});

	it('registers toggle, toggleHeader and toggleBody nodes', () => {
		const editor = make();
		expect(editor.schema.nodes.toggle).toBeDefined();
		expect(editor.schema.nodes.toggleHeader).toBeDefined();
		expect(editor.schema.nodes.toggleBody).toBeDefined();
	});

	it('round-trips the open state and header/body structure to JSON', () => {
		const editor = make();
		editor.chain().insertContent(toggleWith(false)).run();

		const toggle = findNode(editor.getJSON(), 'toggle');
		expect(toggle?.attrs?.open).toBe(false);
		expect(findNode(toggle, 'toggleHeader')?.content[0].text).toBe('Q1');
		expect(findNode(toggle, 'toggleBody')).toBeDefined();
	});

	it('flips the open state through the setToggleOpen command', () => {
		const editor = make();
		editor.chain().insertContent(toggleWith(true)).run();

		const pos = togglePos(editor);
		(editor.commands as any).setToggleOpen(pos, false);

		expect(findNode(editor.getJSON(), 'toggle')?.attrs?.open).toBe(false);
	});
});
