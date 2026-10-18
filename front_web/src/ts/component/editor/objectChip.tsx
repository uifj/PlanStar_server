import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import React from 'react';

import { ObjectLink } from './editorExtensions';

// Resolves the referenced object's display name from the detail store, falling back
// to the raw id when the object has not been loaded into the space yet.
const useObjectLabel = (id: string | null): string => {
	if (!id) {
		return '';
	};

	const detail = S.Detail.get(S.Common.space, id, [ 'id', 'name' ]);

	return detail?.name || id;
};

const ObjectLinkChip = ({ node }: ReactNodeViewProps) => {
	const id = node.attrs.targetObjectId as string | null;
	const label = useObjectLabel(id);

	return (
		<NodeViewWrapper as="span" className="objectChip">
			<span className="objectChip-label">{label}</span>
		</NodeViewWrapper>
	);
};

// The browser build swaps the headless atom node for this one so the chip renders as
// React; the schema (name/group/attrs) is inherited, so JSON round-trips are identical.
export const ObjectLinkChipNode = ObjectLink.extend({
	addNodeView () {
		return ReactNodeViewRenderer(ObjectLinkChip);
	},
});
