// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import { createTextAlign } from './textAlign';

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

describe('createTextAlign', () => {
	const editors: Editor[] = [];
	const make = () => {
		const editor = new Editor({
			extensions: [ StarterKit.configure({ undoRedo: false }), createTextAlign() ],
		});
		editors.push(editor);
		return editor;
	};

	afterEach(() => {
		editors.splice(0).forEach((e) => e.destroy());
	});

	it('round-trips alignment onto a paragraph node', () => {
		const editor = make();
		editor.chain().insertContent('Centered').setTextAlign('center').run();

		const para = findNode(editor.getJSON(), 'paragraph');
		expect(para?.attrs?.textAlign).toBe('center');
	});

	it('aligns headings too', () => {
		const editor = make();
		editor.chain().insertContent('Title').toggleHeading({ level: 2 }).setTextAlign('right').run();

		const heading = findNode(editor.getJSON(), 'heading');
		expect(heading?.attrs?.textAlign).toBe('right');
	});
});
