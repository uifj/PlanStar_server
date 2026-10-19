import { HocuspocusProvider } from '@hocuspocus/provider';
import { EditorContent, useEditor } from '@tiptap/react';
import React, { useEffect, useMemo } from 'react';

import { CalloutNode } from './callout';
import { createCollabExtensions } from './editorExtensions';
import { ObjectLinkChipNode } from './objectChip';
import type { MentionItem } from './objectMention';
import { createObjectMention } from './objectMention';
import { createSlashMenu } from './slashMenu';
import { renderSuggestionPopup } from './suggestionPopup';
import { ToggleNode } from './toggle';

interface Props {
	rootId: string;
	readonly?: boolean;
}

const collabUrl = () => {
	const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined) || `${window.location.origin}/api`;

	return configured.replace(/\/+$/, '').replace(/^http/, 'ws').replace(/\/api$/, '') + '/collab';
};

// Searches the current space for objects whose name matches the typed query, feeding
// the '@' quick-mention popup. Resolves through the existing ObjectSearch command so
// the mention list reflects the same index the rest of the client uses.
const searchMentionItems = (query: string): Promise<MentionItem[]> => {
	return new Promise((resolve) => {
		C.ObjectSearch(S.Common.space, [], [], [ 'id', 'name' ], query, 0, 10, (message: any) => {
			const records = message?.records || [];
			resolve(records.map((it: any) => ({ id: it.id, label: it.name || it.id })));
		});
	});
};

// Both popups share the same floating React list renderer; each suggestion factory
// supplies its own trigger char, item source, command, and plugin key.
const suggestions = [
	{ ...createObjectMention(searchMentionItems), render: renderSuggestionPopup },
	{ ...createSlashMenu(), render: renderSuggestionPopup },
];

// The body is a shared Yjs document (ADR-0018): the provider owns the doc and the
// Collaboration extension binds Tiptap to it, so edits flow over the collab socket
// and persist server-side rather than through block commands.
const CollabBody = (props: Props) => {
	const { rootId, readonly } = props;

	const provider = useMemo(() => new HocuspocusProvider({
		url: collabUrl(),
		name: rootId,
	}), [rootId]);

	const editor = useEditor({
		// Undo/redo comes from the Yjs undo manager, not the local history stack.
		extensions: createCollabExtensions(provider.document, ObjectLinkChipNode, CalloutNode, ToggleNode, suggestions),
		editable: !readonly,
	}, [provider]);

	useEffect(() => {
		// `editable` is only read when useEditor builds the instance, and the deps are the provider,
		// so a page mounted before its object view reaches the store — which is every cold load and
		// deep link — would keep the read-only verdict it guessed at mount forever.
		if (editor) {
			editor.setEditable(!readonly);
		};
	}, [editor, readonly]);

	useEffect(() => {
		return () => {
			provider.destroy();
		};
	}, [provider]);

	return (
		<EditorContent editor={editor} className="collabBody" />
	);
};

export default CollabBody;
