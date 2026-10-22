import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import DropTarget from './target';
import * as I from 'Interface';

const meta: Meta<typeof DropTarget> = {
	title: 'Drag/Target',
	component: DropTarget,
	tags: ['autodocs'],
};

export { meta as default };
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		id: 'target-1',
		rootId: 'root-1',
		cacheKey: 'cache-1',
		dropType: I.DropType.None,
		children: <div style={{ padding: 16, background: '#f0f0f0' }}>Drop target content</div>,
	},
};
