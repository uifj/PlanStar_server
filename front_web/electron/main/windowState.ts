import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, type BrowserWindow, screen } from "electron";

import { logger } from "./logger";

/**
 * Window bounds persistence.
 *
 * Extracted from the original `main.ts` verbatim, plus one improvement: writes are wrapped in a
 * try/catch that logs rather than swallows, so a full disk shows up in the log instead of leaving
 * the user with a mysteriously reset window position on next launch.
 *
 * The "last non-maximized frame" tracking is preserved: closing while maximized must not persist
 * the zoomed bounds, or the next launch opens at screen size even after the user un-maximizes.
 */

export interface WindowState {
	x?: number;
	y?: number;
	width: number;
	height: number;
	maximized: boolean;
}

export const DEFAULT_WINDOW_STATE: WindowState = {
	width: 1280,
	height: 840,
	maximized: false,
};

const STATE_FILE_NAME = "window.json";

const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
/** How much of the saved frame must land on a display before the position is worth restoring. */
const MIN_VISIBLE_PX = 100;

function stateFile(): string {
	return join(app.getPath("userData"), STATE_FILE_NAME);
}

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function overlapsEnough(
	rect: { x: number; y: number; width: number; height: number },
	area: { x: number; y: number; width: number; height: number },
): boolean {
	const width =
		Math.min(rect.x + rect.width, area.x + area.width) -
		Math.max(rect.x, area.x);
	const height =
		Math.min(rect.y + rect.height, area.y + area.height) -
		Math.max(rect.y, area.y);
	return width >= MIN_VISIBLE_PX && height >= MIN_VISIBLE_PX;
}

/**
 * Coerce whatever is on disk into a frame the window can actually open at.
 *
 * `window.json` is user-writable and survives crashes, so nothing in it may be trusted: a `NaN`
 * size or coordinates from a monitor that is no longer plugged in would otherwise open a window
 * off-screen with no way back. Only called from `createWindow`, i.e. after `app.whenReady()`, which
 * is the earliest point `screen` may be used.
 */
export function sanitizeWindowState(raw: unknown): WindowState {
	const input = (
		typeof raw === "object" && raw !== null ? raw : {}
	) as Partial<WindowState>;
	const workArea = screen.getPrimaryDisplay().workArea;

	const rawWidth = finiteNumber(input.width);
	const rawHeight = finiteNumber(input.height);
	const width =
		rawWidth === null || rawWidth < MIN_WIDTH
			? DEFAULT_WINDOW_STATE.width
			: Math.min(Math.round(rawWidth), workArea.width);
	const height =
		rawHeight === null || rawHeight < MIN_HEIGHT
			? DEFAULT_WINDOW_STATE.height
			: Math.min(Math.round(rawHeight), workArea.height);

	const x = finiteNumber(input.x);
	const y = finiteNumber(input.y);
	// Dropping x/y lets Electron centre the window instead of restoring it off-screen.
	const position =
		x !== null &&
		y !== null &&
		screen
			.getAllDisplays()
			.some((display) =>
				overlapsEnough({ x, y, width, height }, display.workArea),
			)
			? { x: Math.round(x), y: Math.round(y) }
			: {};

	return {
		...position,
		width,
		height,
		maximized: input.maximized === true,
	};
}

export function readWindowState(): WindowState {
	try {
		return sanitizeWindowState(JSON.parse(readFileSync(stateFile(), "utf8")));
	} catch {
		return { ...DEFAULT_WINDOW_STATE };
	}
}

export interface WindowStateTracker {
	/** Attach resize/move/close listeners that keep `lastRestored` and the on-disk state fresh. */
	attach(win: BrowserWindow): void;
	/** Force an immediate write (used before quit so a hard exit does not lose the last frame). */
	flush(win: BrowserWindow): void;
}

export function createWindowStateTracker(
	initial: WindowState,
): WindowStateTracker {
	let lastRestored: { x?: number; y?: number; width: number; height: number } =
		{
			x: initial.x,
			y: initial.y,
			width: initial.width,
			height: initial.height,
		};

	const persist = (win: BrowserWindow): void => {
		if (win.isDestroyed()) {
			return;
		}
		const maximized = win.isMaximized();
		// While maximized, getBounds() reports the zoomed frame; keep the restored size instead.
		const bounds = maximized ? lastRestored : win.getBounds();
		lastRestored = bounds;

		const payload: WindowState = { ...bounds, maximized };
		const target = stateFile();
		try {
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, JSON.stringify(payload));
		} catch (error) {
			// A read-only userData dir must not stop the app from closing, but it should be visible.
			logger.warn("[window-state] failed to persist bounds:", error);
		}
	};

	return {
		attach(win) {
			const trackFrame = (): void => {
				if (!win.isDestroyed() && !win.isMaximized()) {
					lastRestored = win.getBounds();
				}
			};
			win.on("resize", trackFrame);
			win.on("move", trackFrame);
			win.on("close", () => persist(win));
		},
		flush(win) {
			persist(win);
		},
	};
}
