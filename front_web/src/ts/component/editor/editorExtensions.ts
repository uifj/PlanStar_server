import { Collaboration } from '@tiptap/extension-collaboration';
import Highlight from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { Extension, Node } from '@tiptap/core';
import type { Extensions, Node as ProseMirrorNode } from '@tiptap/core';
import { Suggestion } from '@tiptap/suggestion';
import type { SuggestionOptions } from '@tiptap/suggestion';
import StarterKit from '@tiptap/starter-kit';
import type { Doc } from 'yjs';

import { Attachment } from './attachment';
import { Callout } from './callout';
import { Dataview } from './dataview';
import { Embed } from './embed';
import { createImage } from './image';
import { createPlaceholder } from './placeholder';
import { createTable } from './table';
import { createTextAlign } from './textAlign';
import { Toggle, ToggleBody, ToggleHeader } from './toggle';

// Inline object mention: renders as an atom chip pointing at another object.
// The targetObjectId attribute survives the Yjs sync round-trip so references
// can be resolved on reopen.
export const ObjectLink = Node.create({
	name: 'objectLink',
	group: 'inline',
	inline: true,
	atom: true,

	addAttributes () {
		return {
			targetObjectId: {
				default: null,
			},
		};
	},

	parseHTML () {
		return [{ tag: 'object-link' }];
	},

	renderHTML ({ node }) {
		return ['object-link', { 'data-object-id': node.attrs.targetObjectId }];
	},
});

// Suggestion ships as a bare ProseMirror plugin factory, so it is wrapped in an
// Extension to bind it to the editor instance and slot into the extension list.
// Each suggestion must carry its own pluginKey so multiple popups ('@' mention,
// '/' block menu) can coexist without colliding on the default key.
const suggestionExtension = (name: string, options: Omit<SuggestionOptions<any, any>, 'editor'>) => {
	return Extension.create({
		name,
		addProseMirrorPlugins () {
			return [ Suggestion({ editor: this.editor, ...options }) ];
		},
	});
};

export function createBlockExtensions (objectLinkNode: ProseMirrorNode = ObjectLink, calloutNode: ProseMirrorNode = Callout, toggleNode: ProseMirrorNode = Toggle): Extensions {
	return [
		StarterKit.configure({ undoRedo: false }),
		TaskList,
		TaskItem,
		TextStyle,
		Color,
		Highlight,
		createTextAlign(),
		createTable(),
		createImage(),
		ToggleHeader,
		ToggleBody,
		toggleNode,
		calloutNode,
		Attachment,
		Embed,
		Dataview,
		objectLinkNode,
	];
};

export function createCollabExtensions (
	document: Doc,
	objectLinkNode: ProseMirrorNode = ObjectLink,
	calloutNode: ProseMirrorNode = Callout,
	toggleNode: ProseMirrorNode = Toggle,
	suggestions: Omit<SuggestionOptions<any, any>, 'editor'>[] = [],
	placeholder = 'Write something, or press / for commands',
): Extensions {
	const extensions: Extensions = [
		...createBlockExtensions(objectLinkNode, calloutNode, toggleNode),
		createPlaceholder(placeholder),
		Collaboration.configure({ document }),
	];

	suggestions.forEach((options, index) => {
		extensions.push(suggestionExtension(`suggestion-${index}`, options));
	});

	return extensions;
};