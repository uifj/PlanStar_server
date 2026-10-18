import { ReactRenderer } from '@tiptap/react';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

// Any suggestion item the popup can render: it only needs an id and a display label.
export interface PopupItem {
	id: string;
	label: string;
}

interface ListProps {
	items: PopupItem[];
	command: (item: any) => void;
}

export interface SuggestionListHandle {
	onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const SuggestionList = forwardRef<SuggestionListHandle, ListProps>(({ items, command }, ref) => {
	const [ selected, setSelected ] = useState(0);

	useEffect(() => {
		setSelected(0);
	}, [ items ]);

	useImperativeHandle(ref, () => ({
		onKeyDown: ({ event }) => {
			if (event.key === 'ArrowUp') {
				setSelected((prev) => (prev + items.length - 1) % items.length);
				return true;
			};

			if (event.key === 'ArrowDown') {
				setSelected((prev) => (prev + 1) % items.length);
				return true;
			};

			if (event.key === 'Enter') {
				const item = items[selected];
				if (item) {
					command(item);
				};
				return true;
			};

			return false;
		},
	}));

	if (!items.length) {
		return <div className="suggestionList suggestionList-empty">No results</div>;
	};

	return (
		<div className="suggestionList" role="listbox">
			{items.map((item, index) => (
				<div
					key={item.id}
					role="option"
					aria-selected={index === selected}
					className={index === selected ? 'suggestionList-item isSelected' : 'suggestionList-item'}
					onMouseDown={(e) => {
						e.preventDefault();
						command(item);
					}}
					onMouseEnter={() => setSelected(index)}
				>
					{item.label}
				</div>
			))}
		</div>
	);
});

SuggestionList.displayName = 'SuggestionList';

// The Suggestion render lifecycle for the browser layer: mount a floating React list
// anchored to the cursor and forward arrow/enter keys into it. Shared by the '@' object
// mention and the '/' block menu — both feed it {id,label} items and a command.
export function renderSuggestionPopup () {
	let component: ReactRenderer<SuggestionListHandle, ListProps> | null = null;
	let unmount: (() => void) | null = null;

	return {
		onStart: (props: SuggestionProps<PopupItem, any>) => {
			component = new ReactRenderer<SuggestionListHandle, ListProps>(SuggestionList, {
				props: { items: props.items, command: props.command },
				editor: props.editor,
			});
			unmount = props.mount(component.element);
		},

		onUpdate: (props: SuggestionProps<PopupItem, any>) => {
			component?.updateProps({ items: props.items, command: props.command });
		},

		onKeyDown: (props: SuggestionKeyDownProps) => component?.ref?.onKeyDown({ event: props.event }) ?? false,

		onExit: () => {
			unmount?.();
			unmount = null;
			component?.destroy();
			component = null;
		},
	};
};
