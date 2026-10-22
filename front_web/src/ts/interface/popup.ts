export interface PopupParam {
	data?: any;
	className?: string;
	preventResize?: boolean;
	preventMenuClose?: boolean;
	preventCloseByClick?: boolean;
	preventCloseByEscape?: boolean;
	// Owns its own lifetime (the forced-update guard): `closeAll()` — a page unmounting during
	// boot, a route change, header navigation — must not dismiss it. Only its owner closes it.
	preventCloseAll?: boolean;
	onOpen?(context: any): void;
	onClose?(): void;
};

export interface Popup {
	id: string;
	param: PopupParam;
	position? (): void;
	close? (callBack?: () => void): void;
	storageGet?(): any;
	storageSet?(data: any): void;
	getId?(): string;
};

export interface PopupUsecase extends Popup {
	onPage(page: string, data: any): void;
	getAuthor(author: string): string;
	onAuthor(author: string): void;
};
