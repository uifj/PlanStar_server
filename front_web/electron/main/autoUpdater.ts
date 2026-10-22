import {
	type ForceUpdateRequiredPayload,
	PlatformChannels,
	type UpdateStatePayload,
} from "@harness/desktop-shared";
import { BrowserWindow, ipcMain, webContents } from "electron";
import {
	CancellationToken,
	type UpdateInfo,
	autoUpdater as updater,
} from "electron-updater";
import { apiUrl } from "./desktop";
import { logger } from "./logger";
import {
	createManifestProvider,
	type ManifestUpdateInfo,
} from "./manifestProvider";
import { isTrustedSenderUrl } from "./trustedUrl";

/**
 * Auto-update controller.
 *
 * The update itself is `electron-updater`'s job: it reads the `latest-mac.yml` that
 * electron-builder emits, verifies the artifact's sha512 and stages the install. This module only
 * (a) points the updater at the harness feed, (b) maps its events onto the renderer's
 * `UpdateStatePayload` state machine and (c) keeps the two policy bits the builder metadata cannot
 * express — `is_forced` and release notes — on the existing `/releases/manifest` channel.
 *
 * Two feeds, two jobs:
 *   GET /api/desktop/releases/feed/<file>.yml  → electron-updater: version + artifact + sha512
 *   GET /api/desktop/releases/manifest         → this module: is_forced, release notes
 *
 * State machine (broadcast on every transition):
 *   idle → checking → { available | not-available | error }
 *   available → downloading → update-downloaded → installing
 *
 * Polling: 15 min background, 2 min while a window is focused (ZCode parity).
 */

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const FOCUSED_POLL_INTERVAL_MS = 2 * 60 * 1000;
/** The updater emits `download-progress` several times a second; the renderer needs far less. */
const PROGRESS_THROTTLE_MS = 250;

export interface AutoUpdaterController {
	checkForUpdates(manualWebContentsId?: number): Promise<void>;
	downloadUpdate(): Promise<void>;
	cancelDownload(): Promise<void>;
	quitAndInstall(): Promise<void>;
	getState(): UpdateStatePayload;
	startPolling(): void;
	stopPolling(): void;
	dispose(): void;
}

export interface AutoUpdaterOptions {
	/** Called when the policy manifest marks the available version as a forced update. */
	onForcedRelease?: (payload: ForceUpdateRequiredPayload) => void;
	/** Called when no update is available, so a previously announced forced update can be retracted. */
	onUpdateNotAvailable?: () => void;
	/** Policy-manifest reader; defaults to the `/releases/manifest` provider. */
	fetchPolicyManifest?: () => Promise<ManifestUpdateInfo | null>;
}

/**
 * `UpdateInfo.releaseNotes` is either a string or the per-version release-note array that
 * electron-builder writes into `latest-mac.yml`. The renderer only renders a string.
 */
function normalizeReleaseNotes(info: UpdateInfo): string | undefined {
	const notes = info.releaseNotes;
	if (!notes) {
		return undefined;
	}
	if (typeof notes === "string") {
		return notes;
	}
	return notes
		.map((entry) => `v${entry.version}\n${entry.note ?? ""}`.trim())
		.join("\n\n");
}

function broadcast(payload: UpdateStatePayload): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send(PlatformChannels.UpdateStateChanged, payload);
		}
	}
}

export function initAutoUpdater(
	options: AutoUpdaterOptions = {},
): AutoUpdaterController {
	const provider = createManifestProvider();
	const fetchPolicyManifest =
		options.fetchPolicyManifest ??
		(() => provider.getLatestVersion().catch(() => null));

	let state: UpdateStatePayload = { kind: "idle" };
	let pollTimer: NodeJS.Timeout | null = null;
	/** True while a poll loop is live (guards `startPolling` across the in-flight first check). */
	let polling = false;
	let disposed = false;
	/** Set by a manual "Check for updates" so the answer can be echoed to that window only. */
	let manualWebContentsId: number | undefined;
	/** Version of the release the updater is currently working on. */
	let activeVersion = "";
	let activeCancellation: CancellationToken | null = null;
	let lastProgressBroadcast = 0;

	const setState = (next: UpdateStatePayload): void => {
		state = next;
		broadcast(next);
	};

	const reportManualResult = (
		payload:
			| { status: "available"; version: string }
			| { status: "not-available"; version?: string }
			| { status: "error"; message: string },
	): void => {
		const id = manualWebContentsId;
		manualWebContentsId = undefined;
		if (id === undefined) {
			return;
		}
		const contents = webContents.fromId(id);
		if (!contents || contents.isDestroyed()) {
			return;
		}
		contents.send(PlatformChannels.UpdateCheckResult, {
			...payload,
			manualWebContentsId: id,
		});
	};

	/**
	 * Forced updates are a server-side policy, not a builder fact: `latest-mac.yml` knows the
	 * version, only `/releases/manifest` knows whether that version is mandatory.
	 *
	 * The three outcomes are deliberately distinct:
	 *   - manifest unreadable  → keep the current state. A network blip must not unlock a UI the
	 *     operator asked to block, and it must not clear a modal the user is reading.
	 *   - this version forced   → announce it (renderer shows the blocking modal).
	 *   - anything else         → retract. This is the only place a withdrawn flag is noticed, because
	 *     `update-not-available` never fires while a newer version exists.
	 */
	const announceIfForced = async (
		version: string,
		releaseNotes?: string,
	): Promise<void> => {
		const manifest = await fetchPolicyManifest();
		if (!manifest) {
			return;
		}
		if (manifest.is_forced && manifest.version === version) {
			options.onForcedRelease?.({
				version,
				releaseNotes: releaseNotes ?? manifest.releaseNotes,
			});
			return;
		}
		options.onUpdateNotAvailable?.();
	};

	const configureUpdater = (): void => {
		updater.autoDownload = true;
		// An unsigned local build cannot be installed by Squirrel.Mac; never try silently on quit.
		updater.autoInstallOnAppQuit = false;
		updater.allowPrerelease = false;
		updater.logger = {
			info: (...args) => logger.info("[electron-updater]", ...args),
			warn: (...args) => logger.warn("[electron-updater]", ...args),
			error: (...args) => logger.error("[electron-updater]", ...args),
			debug: (message) => logger.debug("[electron-updater]", message),
		};
		// `app-update.yml` only carries the placeholder from electron-builder.yml; the real feed
		// depends on the configured backend, so it is resolved at runtime.
		updater.setFeedURL({
			provider: "generic",
			url: `${apiUrl()}/api/desktop/releases/feed/`,
		});
	};

	const wireUpdaterEvents = (): void => {
		updater.on("checking-for-update", () => {
			setState({ kind: "checking" });
		});

		updater.on("update-available", (info) => {
			activeVersion = info.version;
			const notes = normalizeReleaseNotes(info);
			setState({
				kind: "available",
				version: info.version,
				releaseNotes: notes,
			});
			reportManualResult({ status: "available", version: info.version });
			void announceIfForced(info.version, notes);
		});

		updater.on("update-not-available", (info) => {
			activeVersion = info.version;
			activeCancellation = null;
			setState({
				kind: "not-available",
				version: updater.currentVersion.version,
			});
			reportManualResult({ status: "not-available", version: info.version });
			options.onUpdateNotAvailable?.();
		});

		updater.on("download-progress", (progress) => {
			const now = Date.now();
			if (now - lastProgressBroadcast < PROGRESS_THROTTLE_MS) {
				return;
			}
			lastProgressBroadcast = now;
			setState({
				kind: "downloading",
				version: activeVersion,
				progress: Number.isFinite(progress.percent)
					? Math.round(progress.percent)
					: 0,
			});
		});

		updater.on("update-downloaded", (info) => {
			activeVersion = info.version;
			activeCancellation = null;
			setState({
				kind: "update-downloaded",
				version: info.version,
				releaseNotes: normalizeReleaseNotes(info),
			});
		});

		updater.on("error", (error) => {
			const message = error instanceof Error ? error.message : String(error);
			logger.error("[auto-updater] error:", message);
			setState({ kind: "error", message });
			reportManualResult({ status: "error", message });
		});
	};

	const checkForUpdates = async (
		requestingWebContentsId?: number,
	): Promise<void> => {
		if (disposed) {
			return;
		}
		// Only a manual check names a window. A background poll must not overwrite the pending manual
		// answer, or the user's "Check for updates" spinner resolves against the wrong request.
		if (requestingWebContentsId !== undefined) {
			manualWebContentsId = requestingWebContentsId;
		}
		try {
			const result = await updater.checkForUpdates();
			activeCancellation = result?.cancellationToken ?? null;
			// `autoDownload` is on, so the download is already running. Its rejection is reported
			// through the `error` event; swallow it here so it does not surface as unhandled.
			result?.downloadPromise?.catch(() => undefined);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.warn("[auto-updater] check failed:", message);
			setState({ kind: "error", message });
			reportManualResult({ status: "error", message });
		}
	};

	const downloadUpdate = async (): Promise<void> => {
		if (disposed) {
			return;
		}
		const token = activeCancellation ?? new CancellationToken();
		activeCancellation = token;
		try {
			// A download started by `autoDownload` is already in flight; the updater dedupes and
			// returns that same promise, which is exactly the "did I finish?" answer we want.
			await updater.downloadUpdate(token);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/cancel/i.test(message)) {
				setState({ kind: "idle" });
				return;
			}
			logger.error("[auto-updater] download failed:", message);
			setState({ kind: "error", message });
		}
	};

	const cancelDownload = async (): Promise<void> => {
		const token = activeCancellation;
		activeCancellation = null;
		if (!token) {
			logger.warn("[auto-updater] cancel ignored: no download in progress");
			return;
		}
		try {
			token.cancel();
			setState({ kind: "idle" });
		} catch (error) {
			logger.warn("[auto-updater] cancel failed:", error);
		}
	};

	const quitAndInstall = async (): Promise<void> => {
		setState({ kind: "installing", version: activeVersion });
		try {
			updater.quitAndInstall(false, true);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error("[auto-updater] quitAndInstall failed:", message);
			setState({ kind: "error", message });
		}
	};

	const stopPolling = (): void => {
		polling = false;
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	};

	const schedulePoll = (): void => {
		if (disposed) {
			return;
		}
		const focused = BrowserWindow.getAllWindows().some(
			(w) => !w.isDestroyed() && w.isFocused(),
		);
		const interval = focused ? FOCUSED_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
		pollTimer = setTimeout(() => {
			void checkForUpdates().finally(schedulePoll);
		}, interval);
	};

	const registerIpc = (): void => {
		// Download/cancel/install converge on the command bus; only the state query keeps a
		// dedicated channel here.
		ipcMain.handle(PlatformChannels.GetUpdateState, (event) => {
			if (!isTrustedSenderUrl(event.senderFrame?.url)) {
				throw new Error("untrusted sender");
			}
			return state;
		});
	};

	configureUpdater();
	wireUpdaterEvents();
	registerIpc();

	return {
		checkForUpdates,
		downloadUpdate,
		cancelDownload,
		quitAndInstall,
		getState: () => state,
		startPolling: () => {
			if (polling || disposed) {
				return;
			}
			polling = true;
			// Poll immediately, then schedule: waiting a full interval means a just-launched app can sit
			// on a stale build for 15 minutes (and a forced release goes unnoticed that long).
			void checkForUpdates().finally(schedulePoll);
		},
		stopPolling,
		dispose: () => {
			disposed = true;
			stopPolling();
			updater.removeAllListeners();
			ipcMain.removeHandler(PlatformChannels.GetUpdateState);
		},
	};
}

export const __test__ = {
	normalizeReleaseNotes,
	POLL_INTERVAL_MS,
	FOCUSED_POLL_INTERVAL_MS,
	PROGRESS_THROTTLE_MS,
};
