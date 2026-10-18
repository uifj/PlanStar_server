import { mergeAttributes, Node } from '@tiptap/core';

// File attachment body node (ADR-0013's file block): an atom block pointing at a stored
// file (the file store serves bytes at /file/:id). It renders as a download link labelled
// with the filename; the actual upload/drop into the body is the separate P5 track.
export const Attachment = Node.create({
	name: 'attachment',
	group: 'block',
	atom: true,

	addAttributes () {
		return {
			url: {
				default: null,
				parseHTML: (element) => element.getAttribute('href'),
				renderHTML: (attributes) => ({ href: attributes.url }),
			},
			filename: {
				default: '',
			},
			size: {
				default: null,
			},
		};
	},

	parseHTML () {
		return [{ tag: 'a[data-file]' }];
	},

	renderHTML ({ HTMLAttributes, node }) {
		return [
			'a',
			mergeAttributes(HTMLAttributes, { 'data-file': '', class: 'fileAttachment', download: node.attrs.filename }),
			node.attrs.filename || node.attrs.url || 'file',
		];
	},
});
