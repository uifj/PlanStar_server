import { mergeAttributes, Node } from '@tiptap/core';

// Dataview body node (ADR-0013's view block / the P4 prerequisite named by #87): an atom
// block that references a set of types and a default view, standing where an embedded
// Anytype dataview block sits in the page. This slice defines the node so the Yjs body can
// carry it and persist its config; rendering live rows and the BlockDataview* commands are
// follow-on slices.
export const Dataview = Node.create({
	name: 'dataview',
	group: 'block',
	atom: true,

	addAttributes () {
		return {
			targetCollection: {
				default: [],
				parseHTML: (element) => {
					const raw = element.getAttribute('data-target-collection');
					return raw ? raw.split(',').filter(Boolean) : [];
				},
				renderHTML: (attributes) => ({
					'data-target-collection': (attributes.targetCollection as string[]).join(','),
				}),
			},
			defaultView: {
				default: 'table',
				renderHTML: (attributes) => ({ 'data-view': attributes.defaultView }),
			},
		};
	},

	parseHTML () {
		return [{ tag: 'div[data-dataview]' }];
	},

	renderHTML ({ HTMLAttributes, node }) {
		return [
			'div',
			mergeAttributes(HTMLAttributes, { 'data-dataview': '', class: 'dataviewBlock' }),
			`Dataview (${node.attrs.defaultView})`,
		];
	},
});
