import type { Editor, Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import type { SuggestionOptions } from '@tiptap/suggestion';

export type SlashBlockType = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'bulletList' | 'orderedList' | 'taskList' | 'blockquote' | 'codeBlock' | 'table' | 'callout' | 'toggle';

export interface SlashItem {
	id: string;
	label: string;
	keywords: string;
	type: SlashBlockType;
};

const SLASH_ITEMS: SlashItem[] = [
	{ id: 'paragraph', label: 'Text', keywords: 'text paragraph plain', type: 'paragraph' },
	{ id: 'heading1', label: 'Heading 1', keywords: 'h1 title heading', type: 'heading1' },
	{ id: 'heading2', label: 'Heading 2', keywords: 'h2 heading', type: 'heading2' },
	{ id: 'heading3', label: 'Heading 3', keywords: 'h3 heading', type: 'heading3' },
	{ id: 'bulletList', label: 'Bullet List', keywords: 'bullet unordered list ul', type: 'bulletList' },
	{ id: 'orderedList', label: 'Numbered List', keywords: 'number ordered list ol', type: 'orderedList' },
	{ id: 'taskList', label: 'To-do List', keywords: 'todo task check checkbox', type: 'taskList' },
	{ id: 'blockquote', label: 'Quote', keywords: 'quote blockquote citation', type: 'blockquote' },
	{ id: 'codeBlock', label: 'Code Block', keywords: 'code block pre snippet', type: 'codeBlock' },
	{ id: 'table', label: 'Table', keywords: 'table grid rows columns', type: 'table' },
	{ id: 'callout', label: 'Callout', keywords: 'callout note highlight info', type: 'callout' },
	{ id: 'toggle', label: 'Toggle', keywords: 'toggle collapse fold details', type: 'toggle' },
];

// Applies the chosen block type to the paragraph the caret sits in, after erasing the
// typed '/query'. Grown one block family at a time alongside its test.
const applyBlock = (editor: Editor, range: Range, type: SlashBlockType) => {
	const chain = editor.chain().focus().deleteRange(range);

	switch (type) {
		case 'heading1': chain.toggleHeading({ level: 1 }); break;
		case 'heading2': chain.toggleHeading({ level: 2 }); break;
		case 'heading3': chain.toggleHeading({ level: 3 }); break;
		case 'bulletList': chain.toggleBulletList(); break;
		case 'orderedList': chain.toggleOrderedList(); break;
		case 'taskList': chain.toggleTaskList(); break;
		case 'blockquote': chain.toggleBlockquote(); break;
		case 'codeBlock': chain.toggleCodeBlock(); break;
		case 'table': chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }); break;
		case 'callout': chain.insertContent({ type: 'callout', content: [ { type: 'paragraph' } ] }); break;
		case 'toggle': chain.insertContent({ type: 'toggle', attrs: { open: true }, content: [ { type: 'toggleHeader' }, { type: 'toggleBody', content: [ { type: 'paragraph' } ] } ] }); break;
		default: chain.setParagraph(); break;
	};

	chain.run();
};

// '/' block inserter: a static, query-filtered command list whose selection rewrites the
// current block. The editor instance is injected by the wrapping extension.
export function createSlashMenu (): Omit<SuggestionOptions<SlashItem, SlashItem>, 'editor'> {
	return {
		char: '/',
		pluginKey: new PluginKey('slashMenu'),
		startOfLine: false,
		items: ({ query }) => {
			const q = query.toLowerCase().trim();
			if (!q) {
				return SLASH_ITEMS;
			};
			return SLASH_ITEMS.filter(it => it.label.toLowerCase().includes(q) || it.keywords.includes(q));
		},
		command: ({ editor, range, props }) => {
			applyBlock(editor, range, props.type);
		},
	};
};
