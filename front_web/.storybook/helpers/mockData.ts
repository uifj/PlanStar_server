/**
 * Props the popup container (`Component/popup/index.tsx`) injects into every popup component.
 * Stories spread this over their own `args`; the galleries only call `popupProps(id)` today.
 */
export interface StorybookPopupProps {
	id: string;
	param: { data: Record<string, unknown> };
	close: () => void;
	position: () => void;
	getId: () => string;
	storageGet: () => Record<string, unknown>;
	storageSet: () => void;
}

export const popupProps = (
	id: string,
	data: Record<string, unknown> = {},
): StorybookPopupProps => ({
	id,
	param: { data },
	close: () => {},
	position: () => {},
	getId: () => id,
	storageGet: () => ({}),
	storageSet: () => {},
});
