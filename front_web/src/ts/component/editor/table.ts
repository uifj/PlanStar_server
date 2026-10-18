import type { Extension } from '@tiptap/core';
import { TableKit } from '@tiptap/extension-table';

// Anytype-style tables: TableKit bundles the table / row / header / cell nodes and
// their commands (insertTable, add/remove row-column, merge/split cells). Resizable
// lets a user drag column edges, matching the block editor's table affordance.
export function createTable (): Extension<any, any> {
	return TableKit.configure({
		table: { resizable: true },
	});
};
