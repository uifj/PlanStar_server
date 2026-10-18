import { mergeAttributes, Node } from '@tiptap/core';

// Embed body node (ADR-0013's embed block): a source URL shown as a link card. It
// deliberately renders a link rather than a live third-party iframe, so the self-hosted
// body never pulls arbitrary remote scripts; the rich provider preview is a separate
// concern fed by the LinkPreview command.
export const Embed = Node.create({
	name: 'embed',
	group: 'block',
	atom: true,

	addAttributes () {
		return {
			src: {
				default: null,
				parseHTML: (element) => element.getAttribute('data-src'),
				renderHTML: (attributes) => ({ 'data-src': attributes.src }),
			},
			caption: {
				default: '',
			},
		};
	},

	parseHTML () {
		return [{ tag: 'div[data-embed]' }];
	},

	renderHTML ({ HTMLAttributes, node }) {
		return [
			'div',
			mergeAttributes(HTMLAttributes, { 'data-embed': '', class: 'embed' }),
			[ 'a', { href: node.attrs.src, class: 'embed-link', target: '_blank', rel: 'noopener noreferrer nofollow' }, node.attrs.caption || node.attrs.src || '' ],
		];
	},
});
