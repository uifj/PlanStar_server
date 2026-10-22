import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import InputWithFile from './inputWithFile';
import * as I from 'Interface';
import * as M from 'Model';

const meta: Meta<typeof InputWithFile> = {
	title: 'Form/InputWithFile',
	component: InputWithFile,
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div style={{ width: 400 }}>
				<Story />
			</div>
		),
	],
};

export { meta as default };
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		block: new M.Block({ id: 'storybook-block', type: I.BlockType.File, content: {} }),
	},
};

export const WithFile: Story = {
	args: {
		withFile: true,
		textFile: 'Upload a file',
		block: new M.Block({ id: 'storybook-block-file', type: I.BlockType.File, content: {} }),
	},
};

export const Readonly: Story = {
	args: {
		readonly: true,
		block: new M.Block({ id: 'storybook-block-readonly', type: I.BlockType.File, content: {} }),
	},
};
