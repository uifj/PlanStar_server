import type { Extension } from '@tiptap/core';
import TextAlign from '@tiptap/extension-text-align';

// Per-block alignment: Anytype aligns text blocks left/center/right/justify.
// Applied to paragraph + heading so any text block can be aligned; the value
// round-trips as the node's textAlign attribute and renders as text-align style.
export function createTextAlign (): Extension<any, any> {
	return TextAlign.configure({
		types: [ 'paragraph', 'heading' ],
	});
};
