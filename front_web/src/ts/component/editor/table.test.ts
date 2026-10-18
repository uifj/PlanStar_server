// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import { createTable } from './table';

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

describe('createTable', () => {
	const editors: Editor[] = [];
	const make = () => {
		const editor = new Editor({
			extensions: [ StarterKit.configure({ undoRedo: false }), createTable() ],
		});
		editors.push(editor);
		return editor;
	};

	afterEach(() => {
		editors.splice(0).forEach((e) => e.destroy());
	});

	it('inserts a table whose rows and cells round-trip to JSON', () => {
		const editor = make();
		editor.chain().insertTable({ rows: 2, cols: 3, withHeaderRow: false }).run();

		const table = findNode(editor.getJSON(), 'table');
		const rows = table.content.filter((n: any) => n.type === 'tableRow');
		expect(rows.length).toBe(2);
		expect(rows[0].content.filter((n: any) => n.type === 'tableCell').length).toBe(3);
	});

	it('marks the first row as header cells when withHeaderRow is set', () => {
		const editor = make();
		editor.chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();

		const table = findNode(editor.getJSON(), 'table');
		const rows = table.content.filter((n: any) => n.type === 'tableRow');
		expect(rows[0].content.every((n: any) => n.type === 'tableHeader')).toBe(true);
		expect(rows[1].content.every((n: any) => n.type === 'tableCell')).toBe(true);
	});
});
