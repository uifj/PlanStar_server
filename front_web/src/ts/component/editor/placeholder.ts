import type { Extension } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';

// Empty-block hint: an Anytype-style "Write something" affordance that renders
// as a decoration on empty nodes. includeChildren lets nested blocks (list
// items, table cells) show their own hint, not just the top-level paragraph.
export function createPlaceholder (text: string): Extension<any, any> {
	return Placeholder.configure({
		placeholder: text,
		includeChildren: true,
	});
};
