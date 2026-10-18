import { PluginKey } from '@tiptap/pm/state';
import type { SuggestionOptions } from '@tiptap/suggestion';

export interface MentionItem {
	id: string;
	label: string;
};

type ItemLoader = (query: string) => MentionItem[] | Promise<MentionItem[]>;

// '@' quick-mention that turns the typed query into an inline objectLink node
// (ADR-0013's object reference, reified into the Yjs body). The editor instance is
// injected by the wrapping extension, so it is omitted from the returned options.
export function createObjectMention (items: ItemLoader): Omit<SuggestionOptions<MentionItem, MentionItem>, 'editor'> {
	return {
		char: '@',
		pluginKey: new PluginKey('objectMention'),
		items: ({ query }) => items(query),
		command: ({ editor, range, props }) => {
			editor.chain()
				.focus()
				.deleteRange(range)
				.insertContent({ type: 'objectLink', attrs: { targetObjectId: props.id } })
				.run();
		},
	};
};