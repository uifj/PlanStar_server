import {
	type ForceUpdateClearedPayload,
	type ForceUpdateRequiredPayload,
	PlatformChannels,
} from "@harness/desktop-shared";
import { BrowserWindow, ipcMain } from "electron";
import { logger } from "./logger";
import { isTrustedSenderUrl } from "./trustedUrl";

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
 * The guard owns the Signal, not the UI. It exposes three things the renderer needs and a
 * push-only channel cannot provide on its own:
 *   - `GetForceUpdateState` answers "is a blocking update in effect right now?", so a window that
 *     was recreated after the broadcast still opens the modal;
 *   - `ForceUpdateCleared` tells an already-open modal that the server retracted the flag, which
 *     otherwise leaves the UI blocked forever;
 *   - `announce` is idempotent per version, so the 15-minute poll cannot stack modals.
 *
 * Both handlers are registered here (not in `main.ts`) and removed in `dispose()`, so the guard's
 * lifetime matches its IPC surface.
 */

export interface ForceUpdateGuardController {
	/** Called by the auto-updater when a manifest with `is_forced: true` is resolved. */
	announce(payload: ForceUpdateRequiredPayload): void;
	/** Clear the forced state (the server retracted the flag on a later check). */
	clear(): void;
	/** Current state, or `null` when nothing is forced. */
	getCurrent(): ForceUpdateRequiredPayload | null;
	/** Remove the IPC handler. Idempotent. */
	dispose(): void;
}

export function initForceUpdateGuard(): ForceUpdateGuardController {
	let current: ForceUpdateRequiredPayload | null = null;
	let disposed = false;

	const eachWindow = (send: (contents: Electron.WebContents) => void): void => {
		for (const win of BrowserWindow.getAllWindows()) {
			if (win.isDestroyed()) {
				continue;
			}
			send(win.webContents);
		}
	};

	const announce = (payload: ForceUpdateRequiredPayload): void => {
		if (current && current.version === payload.version) {
			// Same version already announced: the poll re-read the manifest. Re-broadcasting would be
			// harmless (the popup dedupes by id) but would also re-open a modal the user just read.
			return;
		}
		current = payload;
		logger.warn("[force-update] required:", payload.version);
		eachWindow((contents) =>
			contents.send(PlatformChannels.ForceUpdateRequired, payload),
		);
	};

	const clear = (): void => {
		const previous = current;
		if (!previous) {
			return;
		}
		current = null;
		logger.info("[force-update] cleared for", previous.version);
		const payload: ForceUpdateClearedPayload = { version: previous.version };
		eachWindow((contents) =>
			contents.send(PlatformChannels.ForceUpdateCleared, payload),
		);
	};

	ipcMain.handle(PlatformChannels.GetForceUpdateState, (event) => {
		if (!isTrustedSenderUrl(event.senderFrame?.url)) {
			throw new Error("untrusted sender");
		}
		return current;
	});

	return {
		announce,
		clear,
		getCurrent: () => current,
		dispose: () => {
			if (disposed) {
				return;
			}
			disposed = true;
			ipcMain.removeHandler(PlatformChannels.GetForceUpdateState);
		},
	};
}
