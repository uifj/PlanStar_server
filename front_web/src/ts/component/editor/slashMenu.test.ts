// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createBlockExtensions } from './editorExtensions';
import { createSlashMenu } from './slashMenu';

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

describe('createSlashMenu', () => {
	const editors: Editor[] = [];
	const make = () => {
		const editor = new Editor({ extensions: createBlockExtensions() });
		editors.push(editor);
		return editor;
	};

	afterEach(() => {
		editors.splice(0).forEach((e) => e.destroy());
	});

	it('turns the current block into a heading when a heading item is chosen', () => {
		const editor = make();
		editor.chain().insertContent('Title').run();

		const slash = createSlashMenu();

		(slash.command as any)({
			editor,
			range: { from: 1, to: 1 },
			props: { id: 'heading2', type: 'heading2' },
		});

		const heading = findNode(editor.getJSON(), 'heading');
		expect(heading?.attrs?.level).toBe(2);
	});

	it('wraps the current block in a bullet list when the bullet item is chosen', () => {
		const editor = make();
		editor.chain().insertContent('item').run();

		const slash = createSlashMenu();

		(slash.command as any)({
			editor,
			range: { from: 1, to: 1 },
			props: { id: 'bulletList', type: 'bulletList' },
		});

		expect(findNode(editor.getJSON(), 'bulletList')).toBeDefined();
	});

	it('wraps the current block in an ordered list when the numbered item is chosen', () => {
		const editor = make();
		editor.chain().insertContent('step').run();

		const slash = createSlashMenu();

		(slash.command as any)({
			editor,
			range: { from: 1, to: 1 },
			props: { id: 'orderedList', type: 'orderedList' },
		});

		expect(findNode(editor.getJSON(), 'orderedList')).toBeDefined();
	});

	it('wraps the current block in a task list when the todo item is chosen', () => {
		const editor = make();
		editor.chain().insertContent('todo').run();

		const slash = createSlashMenu();

		(slash.command as any)({
			editor,
			range: { from: 1, to: 1 },
			props: { id: 'taskList', type: 'taskList' },
		});

		expect(findNode(editor.getJSON(), 'taskList')).toBeDefined();
	});

	it('turns the current block into a quote when the quote item is chosen', () => {
		const editor = make();
		editor.chain().insertContent('quoted').run();

		const slash = createSlashMenu();

		(slash.command as any)({
			editor,
			range: { from: 1, to: 1 },
			props: { id: 'blockquote', type: 'blockquote' },
		});

		expect(findNode(editor.getJSON(), 'blockquote')).toBeDefined();
	});

	it('turns the current block into a code block when the code item is chosen', () => {
		const editor = make();
		editor.chain().insertContent('const x = 1').run();

		const slash = createSlashMenu();

		(slash.command as any)({
			editor,
			range: { from: 1, to: 1 },
			props: { id: 'codeBlock', type: 'codeBlock' },
		});

		expect(findNode(editor.getJSON(), 'codeBlock')).toBeDefined();
	});

	it('inserts a table when the table item is chosen', () => {
		const editor = make();
		editor.chain().insertContent('grid').run();

		const slash = createSlashMenu();

		(slash.command as any)({
			editor,
			range: { from: 1, to: 1 },
			props: { id: 'table', type: 'table' },
		});

		expect(findNode(editor.getJSON(), 'table')).toBeDefined();
	});

	it('inserts a callout when the callout item is chosen', () => {
		const editor = make();
		editor.chain().insertContent('note').run();

		const slash = createSlashMenu();

		(slash.command as any)({
			editor,
			range: { from: 1, to: 1 },
			props: { id: 'callout', type: 'callout' },
		});

		expect(findNode(editor.getJSON(), 'callout')).toBeDefined();
	});

	it('inserts a toggle when the toggle item is chosen', () => {
		const editor = make();
		editor.chain().insertContent('fold').run();

		const slash = createSlashMenu();

		(slash.command as any)({
			editor,
			range: { from: 1, to: 1 },
			props: { id: 'toggle', type: 'toggle' },
		});

		expect(findNode(editor.getJSON(), 'toggle')).toBeDefined();
	});

	it('narrows the item list by the typed query and lists everything when empty', () => {
		const slash = createSlashMenu();

		const all = (slash.items as any)({ query: '' });
		expect(all.length).toBeGreaterThan(1);

		const h2 = (slash.items as any)({ query: 'h2' });
		expect(h2.map((it: any) => it.id)).toEqual([ 'heading2' ]);
	});
});
