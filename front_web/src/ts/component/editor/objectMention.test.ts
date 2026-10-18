// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createBlockExtensions } from './editorExtensions';
import { createObjectMention } from './objectMention';

const findNode = (node: any, type: string): any => {
	if (!node || typeof node !== 'object') return undefined;
	if (node.type === type) return node;
	if (Array.isArray(node.content)) {
		for (const child of node.content) {
			const found = findNode(child, type);
			if (found) return found;
		}
	}
	return undefined;
};

describe('createObjectMention', () => {
	const editors: Editor[] = [];
	const make = () => {
		const editor = new Editor({ extensions: createBlockExtensions() });
		editors.push(editor);
		return editor;
	};

	afterEach(() => {
		editors.splice(0).forEach((e) => e.destroy());
	});

	it('replaces the typed @query with an objectLink carrying the selected id', () => {
		const editor = make();
		editor.chain().insertContent('see @tri').run();

		const suggestion = createObjectMention(() => [{ id: 'obj999', label: 'Trip to Lisbon' }]);

		(suggestion.command as any)({
			editor,
			range: { from: 5, to: 9 },
			props: { id: 'obj999' },
		});

		const link = findNode(editor.getJSON(), 'objectLink');
		expect(link?.attrs?.targetObjectId).toBe('obj999');
		expect(editor.getText()).toBe('see ');
	});
});