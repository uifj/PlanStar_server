import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import SelectionTarget from './target';
import * as I from 'Interface';

const meta: Meta<typeof SelectionTarget> = {
	title: 'Selection/Target',
	component: SelectionTarget,
	tags: ['autodocs'],
};

export { meta as default };
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		id: 'selection-1',
		type: I.SelectType.Block,
		children: <div style={{ padding: 16 }}>Selectable content</div>,
	},
};
