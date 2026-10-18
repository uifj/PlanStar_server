import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import React from 'react';

// Emoji the icon cycles through when clicked, mirroring Anytype's quick callout-icon picker.
const CALLOUT_ICONS = [ '💡', '🎉', '🔥', '⚠️', '✅', '📌' ];

const CalloutView = ({ node, editor, getPos }: ReactNodeViewProps) => {
	const icon = (node.attrs.icon as string) || CALLOUT_ICONS[0];

	// Clicking the icon advances it to the next preset and writes the new value back
	// onto the node, so the choice persists in the shared Yjs document.
	const cycleIcon = () => {
		const pos = getPos();
		if (typeof pos !== 'number') {
			return;
		};

		const next = CALLOUT_ICONS[(CALLOUT_ICONS.indexOf(icon) + 1) % CALLOUT_ICONS.length];
		editor.chain().command(({ tr }) => {
			tr.setNodeMarkup(pos, undefined, { ...node.attrs, icon: next });
			return true;
		}).run();
	};

	return (
		<NodeViewWrapper as="div" className="callout" data-callout="">
			<span
				className="callout-icon"
				contentEditable={false}
				role="button"
				tabIndex={0}
				aria-label="Callout icon"
				onClick={cycleIcon}
			>
				{icon}
			</span>
			<NodeViewContent as="div" className="callout-content" />
		</NodeViewWrapper>
	);
};

// Anytype callout: a highlighted block that carries an emoji icon and nests any
// block content. The headless node round-trips icon + children through JSON; the
// browser build (CalloutNode) renders the icon as a React NodeView with content editing.
export const Callout = Node.create({
	name: 'callout',
	group: 'block',
	content: 'block+',

	addAttributes () {
		return {
			icon: {
				default: CALLOUT_ICONS[0],
				renderHTML: (attributes) => ({ 'data-icon': attributes.icon }),
			},
		};
	},

	parseHTML () {
		return [{ tag: 'div[data-callout]' }];
	},

	renderHTML ({ HTMLAttributes }) {
		return [
			'div',
			mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'callout' }),
			[ 'span', { class: 'callout-icon' }, HTMLAttributes['data-icon'] || CALLOUT_ICONS[0] ],
			[ 'div', { class: 'callout-content' }, 0 ],
		];
	},
});

export const CalloutNode = Callout.extend({
	addNodeView () {
		return ReactNodeViewRenderer(CalloutView);
	},
});
