// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createBlockExtensions } from './editorExtensions';
import { createDragHandle, renderDragHandleGrip } from './dragHandle';

describe('createDragHandle', () => {
	const editors: Editor[] = [];
	const make = () => {
		const editor = new Editor({
			extensions: [ ...createBlockExtensions(), ...createDragHandle() ],
		});
		editors.push(editor);
		return editor;
	};

	afterEach(() => {
		editors.splice(0).forEach((e) => e.destroy());
	});

	it('renders a grip element exposed as a reorder control', () => {
		const grip = renderDragHandleGrip();

		expect(grip.classList.contains('dragHandle')).toBe(true);
		expect(grip.getAttribute('role')).toBe('button');
	});

	it('registers the drag-handle commands alongside the block schema', () => {
		const editor = make();

		expect(editor.schema.nodes.objectLink).toBeDefined();
		expect(editor.commands.toggleDragHandle).toBeTypeOf('function');
		expect(editor.commands.toggleDragHandle()).toBe(true);
	});
});
