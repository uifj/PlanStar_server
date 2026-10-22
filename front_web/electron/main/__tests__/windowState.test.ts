import { describe, expect, it, vi } from "vitest";

// `windowState.ts` only touches `electron` through `app.getPath` / `screen`, both of which need a
// running Electron. The display geometry below stands in for a laptop plus an external monitor.
vi.mock("electron", () => {
	const primary = { x: 0, y: 0, width: 1920, height: 1080 };
	const secondary = { x: 1920, y: 0, width: 1280, height: 800 };
	return {
		app: { getPath: () => "/tmp/desktop-window-state-test" },
		screen: {
			getPrimaryDisplay: () => ({ workArea: primary }),
			getAllDisplays: () => [{ workArea: primary }, { workArea: secondary }],
		},
	};
});

import {
	DEFAULT_WINDOW_STATE,
	sanitizeWindowState,
	type WindowState,
} from "../windowState";

/**
 * `window.json` is user-writable, so every field must be treated as hostile input: the window has
 * to open somewhere the user can reach it, whatever the file says.
 */
describe("sanitizeWindowState", () => {
	const isOnScreen = (state: WindowState): boolean => {
		const { x, y } = state;
		if (x === undefined || y === undefined) {
			return false;
		}
		const displays = [
			{ x: 0, y: 0, width: 1920, height: 1080 },
			{ x: 1920, y: 0, width: 1280, height: 800 },
		];
		return displays.some(
			(area) =>
				Math.min(x + state.width, area.x + area.width) - Math.max(x, area.x) >=
					100 &&
				Math.min(y + state.height, area.y + area.height) -
					Math.max(y, area.y) >=
					100,
		);
	};

	it("restores a frame that is still on a connected display", () => {
		const state = sanitizeWindowState({
			x: 100,
			y: 120,
			width: 1280,
			height: 840,
			maximized: true,
		});
		expect(state).toEqual({
			x: 100,
			y: 120,
			width: 1280,
			height: 840,
			maximized: true,
		});
	});

	it("replaces negative dimensions with the defaults", () => {
		const state = sanitizeWindowState({ width: -400, height: -300 });
		expect(state.width).toBe(DEFAULT_WINDOW_STATE.width);
		expect(state.height).toBe(DEFAULT_WINDOW_STATE.height);
	});

	it("replaces NaN dimensions with the defaults", () => {
		const state = sanitizeWindowState({
			width: Number.NaN,
			height: Number.NaN,
		});
		expect(state.width).toBe(DEFAULT_WINDOW_STATE.width);
		expect(state.height).toBe(DEFAULT_WINDOW_STATE.height);
	});

	it("clamps a frame larger than the screen to the work area", () => {
		const state = sanitizeWindowState({ width: 5000, height: 4000 });
		expect(state.width).toBe(1920);
		expect(state.height).toBe(1080);
	});

	it("drops coordinates that no longer land on a display", () => {
		const state = sanitizeWindowState({
			x: 9000,
			y: 9000,
			width: 1280,
			height: 840,
		});
		expect(state.x).toBeUndefined();
		expect(state.y).toBeUndefined();
		expect(isOnScreen(state)).toBe(false);
	});

	it("keeps coordinates that land on a secondary display", () => {
		const state = sanitizeWindowState({
			x: 2000,
			y: 100,
			width: 1200,
			height: 800,
		});
		expect(state.x).toBe(2000);
		expect(state.y).toBe(100);
		expect(isOnScreen(state)).toBe(true);
	});

	it("forces `maximized` to a boolean instead of trusting the file", () => {
		const state = sanitizeWindowState({
			width: 1280,
			height: 840,
			maximized: "yes",
		});
		expect(state.maximized).toBe(false);
	});

	it("survives a non-object payload", () => {
		const state = sanitizeWindowState(null);
		expect(state).toEqual(DEFAULT_WINDOW_STATE);
	});
});
