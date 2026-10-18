// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import { createImage } from './image';

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

describe('createImage', () => {
	const editors: Editor[] = [];
	const make = () => {
		const editor = new Editor({
			extensions: [ StarterKit.configure({ undoRedo: false }), createImage() ],
		});
		editors.push(editor);
		return editor;
	};

	afterEach(() => {
		editors.splice(0).forEach((e) => e.destroy());
	});

	it('round-trips src/alt/width onto the image node JSON', () => {
		const editor = make();
		(editor.commands as any).setImage({ src: 'https://cdn/x.png', alt: 'a chart', width: 240 });

		const image = findNode(editor.getJSON(), 'image');
		expect(image?.attrs?.src).toBe('https://cdn/x.png');
		expect(image?.attrs?.alt).toBe('a chart');
		expect(image?.attrs?.width).toBe(240);
	});

	it('renders the image as an img tag carrying its src', () => {
		const editor = make();
		(editor.commands as any).setImage({ src: 'https://cdn/x.png', alt: 'a chart' });

		const html = editor.getHTML();
		expect(html).toContain('<img');
		expect(html).toContain('src="https://cdn/x.png"');
	});
});
