import type { Extensions } from '@tiptap/core';
import DragHandle from '@tiptap/extension-drag-handle';
import { NodeRange } from '@tiptap/extension-node-range';

// The grip the drag handle floats beside a hovered block. DragHandle wires the
// pointer/drag behaviour onto whatever element render() returns, so this only
// has to build the visible affordance.
export function renderDragHandleGrip (): HTMLElement {
	const grip = document.createElement('div');
	grip.className = 'dragHandle';
	grip.setAttribute('role', 'button');
	grip.setAttribute('aria-label', 'Drag to reorder');
	grip.textContent = '⠿';

	return grip;
};

// Block reordering (ADR-0013's ordered blocks): DragHandle supplies the grip and
// the drag transaction, NodeRange supplies the block-span selection it drags.
// nested:true extends the handle into list items and quotes, not just top-level blocks.
export function createDragHandle (): Extensions {
	return [
		NodeRange,
		DragHandle.configure({
			render: renderDragHandleGrip,
			nested: true,
		}),
	];
};
