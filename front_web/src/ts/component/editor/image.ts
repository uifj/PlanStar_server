import type { Node } from '@tiptap/core';
import Image from '@tiptap/extension-image';

// Image body node. The editor holds an image by URL (the file store serves uploaded
// bytes at /file/:id, so a body image points at that URL). allowBase64 lets inline data
// URIs survive too. Resizing on-disk is a separate concern (P5 thumbnails).
export function createImage (): Node<any, any> {
	return Image.configure({
		allowBase64: true,
		HTMLAttributes: { class: 'bodyImage' },
	});
};
