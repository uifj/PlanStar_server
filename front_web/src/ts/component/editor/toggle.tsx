import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import React from 'react';

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		toggle: {
			setToggleOpen: (pos: number, open: boolean) => ReturnType;
		};
	}
};

// The clickable header (a single line of text) and the collapsible body (any blocks)
// are separate child nodes so the wrapper can toggle just the body's visibility.
export const ToggleHeader = Node.create({
	name: 'toggleHeader',
	group: 'block',
	content: 'inline*',

	parseHTML () {
		return [{ tag: 'div[data-toggle-header]' }];
	},

	renderHTML ({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle-header': '', class: 'toggle-header' }), 0];
	},
});

export const ToggleBody = Node.create({
	name: 'toggleBody',
	group: 'block',
	content: 'block+',

	parseHTML () {
		return [{ tag: 'div[data-toggle-body]' }];
	},

	renderHTML ({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle-body': '', class: 'toggle-body' }), 0];
	},
});

// Anytype toggle/collapsible block: a header that shows or hides its nested body.
// The open state lives on the wrapper node so it round-trips through the shared doc.
export const Toggle = Node.create({
	name: 'toggle',
	group: 'block',
	content: 'toggleHeader toggleBody',

	addAttributes () {
		return {
			open: {
				default: true,
				renderHTML: (attributes) => ({ 'data-open': attributes.open ? 'true' : 'false' }),
				parseHTML: (element) => element.getAttribute('data-open') !== 'false',
			},
		};
	},

	parseHTML () {
		return [{ tag: 'div[data-toggle]' }];
	},

	renderHTML ({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle': '', class: 'toggle' }), 0];
	},

	addCommands () {
		return {
			setToggleOpen: (pos: number, open: boolean) => ({ tr, dispatch }) => {
				const node = tr.doc.nodeAt(pos);
				if (!node || node.type.name !== this.name) {
					return false;
				};

				if (dispatch) {
					tr.setNodeMarkup(pos, undefined, { ...node.attrs, open });
				}

				return true;
			},
		};
	},
});

const ToggleView = ({ node, editor, getPos }: ReactNodeViewProps) => {
	const open = !!node.attrs.open;

	const flip = () => {
		const pos = getPos();
		if (typeof pos !== 'number') {
			return;
		}

		editor.chain().command(({ tr }) => {
			tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: !open });
			return true;
		}).run();
	};

	return (
		<NodeViewWrapper as="div" className="toggle" data-toggle="" data-open={open ? 'true' : 'false'}>
			<span
				className="toggle-caret"
				contentEditable={false}
				role="button"
				tabIndex={0}
				aria-expanded={open}
				aria-label="Toggle section"
				onClick={flip}
			>
				{open ? '▾' : '▸'}
			</span>
			<NodeViewContent as="div" className="toggle-inner" />
		</NodeViewWrapper>
	);
};

export const ToggleNode = Toggle.extend({
	addNodeView () {
		return ReactNodeViewRenderer(ToggleView);
	},
});
