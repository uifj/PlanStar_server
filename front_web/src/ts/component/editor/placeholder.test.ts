// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import { createPlaceholder } from './placeholder';

describe('createPlaceholder', () => {
	const editors: Editor[] = [];
	const make = (text: string) => {
		const editor = new Editor({
			extensions: [ StarterKit.configure({ undoRedo: false }), createPlaceholder(text) ],
		});
		editors.push(editor);
		return editor;
	};

	afterEach(() => {
		editors.splice(0).forEach((e) => e.destroy());
	});

	it('decorates an empty block with the configured placeholder text', () => {
		const editor = make('Write something');

		const decorated = editor.view.dom.querySelector('[data-placeholder]');
		expect(decorated?.getAttribute('data-placeholder')).toBe('Write something');
		expect(decorated?.classList.contains('is-empty')).toBe(true);
	});

	it('clears the placeholder once the block has content', () => {
		const editor = make('Write something');
		editor.chain().insertContent('Hello').run();

		expect(editor.view.dom.querySelector('[data-placeholder]')).toBeNull();
	});
});
