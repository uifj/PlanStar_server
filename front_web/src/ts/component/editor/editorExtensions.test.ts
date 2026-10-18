// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createBlockExtensions } from './editorExtensions';

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

describe('createBlockExtensions', () => {
	const editors: Editor[] = [];
	const make = () => {
		const editor = new Editor({ extensions: createBlockExtensions() });
		editors.push(editor);
		return editor;
	};

	afterEach(() => {
		editors.splice(0).forEach((e) => e.destroy());
	});

	it('registers an objectLink node that round-trips targetObjectId to JSON', () => {
		const editor = make();
		expect(editor.schema.nodes.objectLink).toBeDefined();

		editor.chain()
			.insertContent('see ')
			.insertContent({ type: 'objectLink', attrs: { targetObjectId: 'obj123' } })
			.run();

		const link = findNode(editor.getJSON(), 'objectLink');
		expect(link?.attrs?.targetObjectId).toBe('obj123');
	});

	it('keeps StarterKit headings reachable', () => {
		const editor = make();
		editor.chain().insertContent('Hello').run();
		editor.chain().toggleHeading({ level: 2 }).run();

		const heading = findNode(editor.getJSON(), 'heading');
		expect(heading?.attrs?.level).toBe(2);
	});

	it('registers task lists whose checked state round-trips to JSON', () => {
		const editor = make();
		expect(editor.schema.nodes.taskList).toBeDefined();
		expect(editor.schema.nodes.taskItem).toBeDefined();

		editor.chain()
			.insertContent({
				type: 'taskList',
				content: [
					{
						type: 'taskItem',
						attrs: { checked: true },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'buy milk' }] }],
					},
				],
			})
			.run();

		const item = findNode(editor.getJSON(), 'taskItem');
		expect(item?.attrs?.checked).toBe(true);
	});

	it('registers inline color and highlight marks', () => {
		const editor = make();
		expect(editor.schema.marks.textStyle).toBeDefined();
		expect(editor.schema.marks.highlight).toBeDefined();

		editor.chain().insertContent('colored').run();
		editor.chain().setTextSelection({ from: 1, to: 8 }).run();
		editor.chain().setColor('#e03131').toggleHighlight().run();

		const marks = editor.getJSON().content
			.flatMap((p: any) => p.content || [])
			.filter((n: any) => n.type === 'text')
			.flatMap((n: any) => n.marks || []);

		expect(marks.some((m: any) => m.type === 'textStyle' && m.attrs?.color === '#e03131')).toBe(true);
		expect(marks.some((m: any) => m.type === 'highlight')).toBe(true);
	});
});