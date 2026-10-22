import type { Meta, StoryObj } from '@storybook/react';
import MediaState from './mediaState';

const meta: Meta<typeof MediaState> = {
	title: 'Util/MediaState',
	component: MediaState,
	tags: ['autodocs'],
};

export { meta as default };
type Story = StoryObj<typeof meta>;

export const Deleted: Story = {
	args: {
		object: { id: 'media-deleted', isDeleted: true, isArchived: false, name: 'photo.jpg' },
		rootId: 'root-1',
		typeName: 'Image',
	},
};

export const Archived: Story = {
	args: {
		object: { id: 'media-archived', isDeleted: false, isArchived: true, name: 'document.pdf' },
		rootId: 'root-1',
		typeName: 'File',
	},
};

export const Neither: Story = {
	args: {
		object: { id: 'media-neither', isDeleted: false, isArchived: false, name: 'Page' },
		rootId: 'root-1',
		typeName: 'Page',
	},
};
