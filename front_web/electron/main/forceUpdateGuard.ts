import {
	type ForceUpdateRequiredPayload,
	PlatformChannels,
} from "@harness/desktop-shared";
import { BrowserWindow, ipcMain } from "electron";
import { logger } from "./logger";

/**
 * Force-update guard.
 *
 * When the manifest marks a release as `is_forced: true` and the current version is older, the
 * shell must block the UI until the user installs the update. ZCode's 254-line
 * `forceUpdateGuard.ts` carries preview-channel logic, grey-release filters and a staged
 * "nag → warn → block" escalation; front_web only needs the terminal state: broadcast
 * `ForceUpdateRequired` and let the renderer show a modal with a single "Restart to Update"
 * button.
 *
 * The guard is deliberately dumb: it does **not** create its own dialog, does not poll, and does
 * not own state beyond "has a forced update been announced". The renderer owns the UI; the shell
 * only owns the signal.
 */

export interface ForceUpdateGuardController {
	/** Called by the auto-updater when a manifest with `is_forced: true` is resolved. */
	announce(payload: ForceUpdateRequiredPayload): void;
	/** Clear the forced state (e.g. after the user installs, or the server retracts the flag). */
	clear(): void;
	/** Whether a forced update is currently announced. */
	isForced(): boolean;
	dispose(): void;
}

export function initForceUpdateGuard(): ForceUpdateGuardController {
	let current: ForceUpdateRequiredPayload | null = null;

	const broadcast = (payload: ForceUpdateRequiredPayload | null): void => {
		for (const win of BrowserWindow.getAllWindows()) {
			if (win.isDestroyed()) {
				continue;
			}
			if (payload) {
				win.webContents.send(PlatformChannels.ForceUpdateRequired, payload);
			}
		}
	};

	const announce = (payload: ForceUpdateRequiredPayload): void => {
		if (current && current.version === payload.version) {
			return;
		}
		current = payload;
		logger.warn("[force-update] required:", payload.version);
		broadcast(payload);
	};

	const clear = (): void => {
		if (!current) {
			return;
		}
		logger.info("[force-update] cleared for", current.version);
		current = null;
	};

	// The renderer can ask "am I blocked right now?" on mount so a late-loading window does not
	// miss the announcement.
	ipcMain.handle(PlatformChannels.ForceUpdateRequired, () => current);

	return {
		announce,
		clear,
		isForced: () => current !== null,
		dispose: () => {
			ipcMain.removeHandler(PlatformChannels.ForceUpdateRequired);
		},
	};
}
