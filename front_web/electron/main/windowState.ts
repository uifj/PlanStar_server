import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, type BrowserWindow } from "electron";

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

function stateFile(): string {
	return join(app.getPath("userData"), STATE_FILE_NAME);
}

export function readWindowState(): WindowState {
	try {
		const raw = readFileSync(stateFile(), "utf8");
		const parsed = JSON.parse(raw) as Partial<WindowState>;
		return { ...DEFAULT_WINDOW_STATE, ...parsed };
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
