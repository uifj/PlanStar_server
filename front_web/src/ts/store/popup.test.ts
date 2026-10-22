import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { Popup } from "./popup";

/**
 * `closeAll()` is the page-level sweep: the first route unmounts while the app is still booting,
 * and every later navigation unmounts the previous page. A popup that owns its lifetime — the
 * forced-update guard — must survive that sweep; only its owner may close it.
 */

const toastHide = vi.fn();
const updateTabsDimmer = vi.fn();

beforeEach(() => {
	(globalThis as any).Preview = { toastHide };
	(globalThis as any).U = {
		...(globalThis as any).U,
		Data: { updateTabsDimmer },
		Dom: { get: () => null, removeClass: () => undefined, eventDispatch: () => undefined },
	};
	(globalThis as any).J = {
		...(globalThis as any).J,
		Constant: { ...(globalThis as any).J.Constant, delay: { popup: 0 } },
	};
	toastHide.mockClear();
	updateTabsDimmer.mockClear();
	Popup.popupList = [];
});

afterEach(() => {
	vi.useRealTimers();
});

describe("PopupStore.closeAll", () => {
	it("closes every popup a page opened", () => {
		Popup.popupList = [
			{ id: "confirm", param: {} },
			{ id: "search", param: {} },
		];

		Popup.closeAll();

		expect(Popup.popupList).toEqual([]);
	});

	it("keeps a popup that owns its lifetime", () => {
		Popup.popupList = [
			{ id: "forceUpdate", param: { preventCloseAll: true } },
			{ id: "confirm", param: {} },
		];

		Popup.closeAll();

		expect(Popup.popupList.map((it) => it.id)).toEqual(["forceUpdate"]);
	});

	it("still closes it when its owner asks", () => {
		vi.useFakeTimers();
		Popup.popupList = [
			{ id: "forceUpdate", param: { preventCloseAll: true } },
		];

		Popup.close("forceUpdate");
		vi.runAllTimers();

		expect(Popup.popupList).toEqual([]);
	});
});
