import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type AutoUpdatePreferences,
	PlatformChannels,
	type UpdateCheckResultPayload,
	type UpdateStatePayload,
} from "@harness/desktop-shared";
import { app, BrowserWindow, ipcMain } from "electron";
import { logger } from "./logger";
import {
	createManifestProvider,
	type ManifestUpdateInfo,
	type ManifestUpdateProvider,
} from "./manifestProvider";

/**
 * Auto-update controller.
 *
 * The plan calls for `electron-updater`; because the dependency is not yet installed we keep the
 * public surface identical and delegate the heavy lifting (download, signature verification,
 * staged install) to a lazily-required `electron-updater` instance. When the module is missing
 * the controller degrades to "check manifest → report available/not-available" and refuses to
 * download, which is the safe default for a dev build that has no signed artifact to offer.
 *
 * State machine (broadcast on every transition):
 *   idle → checking → { available | not-available | error }
 *   available → downloading → update-downloaded → installing
 *
 * Polling: 15 min background, 2 min while a window is focused (ZCode parity).
 */

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const FOCUSED_POLL_INTERVAL_MS = 2 * 60 * 1000;
const SETTINGS_FILE = "settings.json";

type UpdaterModule = {
	autoUpdater: {
		autoDownload: boolean;
		autoInstallOnAppQuit: boolean;
		setFeedURL(options: {
			provider: string;
			url: string;
			channel?: string;
		}): void;
		on(event: string, listener: (...args: unknown[]) => void): void;
		downloadUpdate(): Promise<unknown>;
		cancelUpdate?(): void;
		quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
	};
} | null;

let updaterModule: UpdaterModule = null;
let updaterModuleResolved = false;

function resolveUpdaterModule(): UpdaterModule {
	if (updaterModuleResolved) {
		return updaterModule;
	}
	updaterModuleResolved = true;
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		updaterModule = require("electron-updater") as UpdaterModule;
	} catch {
		updaterModule = null;
		logger.warn(
			"[auto-updater] electron-updater not installed; download/install disabled",
		);
	}
	return updaterModule;
}

export interface AutoUpdaterController {
	checkForUpdates(manualWebContentsId?: number): Promise<void>;
	downloadUpdate(): Promise<void>;
	cancelDownload(): Promise<void>;
	quitAndInstall(): Promise<void>;
	getState(): UpdateStatePayload;
	getPreferences(): AutoUpdatePreferences;
	setAutoDownloadAndInstall(enabled: boolean): Promise<void>;
	startPolling(): void;
	stopPolling(): void;
	dispose(): void;
}

export interface InitAutoUpdaterOptions {
	provider?: ManifestUpdateProvider;
	/** Persisted preferences; defaults to `{ autoDownloadAndInstall: true, skippedVersions: [] }`. */
	preferences?: AutoUpdatePreferences;
	/** Override for tests. */
	now?: () => Date;
}

function settingsPath(): string {
	return join(app.getPath("userData"), SETTINGS_FILE);
}

function readPreferences(): AutoUpdatePreferences {
	try {
		if (!existsSync(settingsPath())) {
			return { autoDownloadAndInstall: true, skippedVersions: [] };
		}
		const raw = readFileSync(settingsPath(), "utf8");
		const parsed = JSON.parse(raw) as Partial<AutoUpdatePreferences> & {
			version?: number;
		};
		return {
			autoDownloadAndInstall: parsed.autoDownloadAndInstall ?? true,
			skippedVersions: Array.isArray(parsed.skippedVersions)
				? parsed.skippedVersions
				: [],
		};
	} catch (error) {
		logger.warn("[auto-updater] failed to read preferences:", error);
		return { autoDownloadAndInstall: true, skippedVersions: [] };
	}
}

function writePreferences(prefs: AutoUpdatePreferences): void {
	try {
		mkdirSync(app.getPath("userData"), { recursive: true });
		writeFileSync(
			settingsPath(),
			JSON.stringify({ version: 1, ...prefs }, null, 2),
		);
	} catch (error) {
		logger.warn("[auto-updater] failed to persist preferences:", error);
	}
}

function broadcast(payload: UpdateStatePayload): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send(PlatformChannels.UpdateStateChanged, payload);
		}
	}
}

function sendCheckResult(payload: UpdateCheckResultPayload): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send(PlatformChannels.UpdateCheckResult, payload);
		}
	}
}

function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
	const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) {
			return diff < 0 ? -1 : 1;
		}
	}
	return 0;
}

export function initAutoUpdater(
	options: InitAutoUpdaterOptions = {},
): AutoUpdaterController {
	const provider = options.provider ?? createManifestProvider();
	let preferences: AutoUpdatePreferences =
		options.preferences ?? readPreferences();
	let state: UpdateStatePayload = { kind: "idle", enabled: true };
	let latestManifest: ManifestUpdateInfo | null = null;
	let pollTimer: NodeJS.Timeout | null = null;
	let disposed = false;

	const setState = (next: UpdateStatePayload): void => {
		state = next;
		broadcast(next);
	};

	const setUpdaterFeed = (): void => {
		const mod = resolveUpdaterModule();
		if (!mod) {
			return;
		}
		try {
			mod.autoUpdater.autoDownload = false;
			mod.autoUpdater.autoInstallOnAppQuit = false;
			// The generic provider is wired through electron-builder's `publish` config; when the
			// manifest lives on the harness server we override the feed URL at runtime.
			mod.autoUpdater.setFeedURL({
				provider: "generic",
				url:
					(provider as unknown as { options?: { baseUrl?: string } }).options
						?.baseUrl ?? "",
				channel: "stable",
			});
		} catch (error) {
			logger.warn(
				"[auto-updater] failed to configure electron-updater:",
				error,
			);
		}
	};

	const wireUpdaterEvents = (): void => {
		const mod = resolveUpdaterModule();
		if (!mod) {
			return;
		}
		const au = mod.autoUpdater;
		au.on("checking-for-update", () =>
			setState({ kind: "checking", enabled: true }),
		);
		au.on("update-available", (...args: unknown[]) => {
			const info = (args[0] ?? {}) as {
				version?: string;
				releaseNotes?: string;
			};
			setState({
				kind: "available",
				enabled: true,
				version: info.version ?? "",
				releaseNotes: info.releaseNotes,
			});
		});
		au.on("update-not-available", (...args: unknown[]) => {
			const info = (args[0] ?? {}) as { version?: string };
			setState({
				kind: "not-available",
				enabled: true,
				version: info.version ?? "",
			});
		});
		au.on("download-progress", (...args: unknown[]) => {
			const progress = (args[0] ?? {}) as { percent?: number };
			setState({
				kind: "downloading",
				enabled: true,
				version: latestManifest?.version ?? "",
				progress: progress.percent ?? 0,
			});
		});
		au.on("update-downloaded", (...args: unknown[]) => {
			const info = (args[0] ?? {}) as {
				version?: string;
				releaseNotes?: string;
			};
			setState({
				kind: "update-downloaded",
				enabled: true,
				version: info.version ?? "",
				releaseNotes: info.releaseNotes,
			});
		});
		au.on("error", (...args: unknown[]) => {
			const error = args[0];
			logger.error("[auto-updater] electron-updater error:", error);
			setState({
				kind: "error",
				enabled: true,
				message: error instanceof Error ? error.message : String(error),
			});
		});
	};

	const checkForUpdates = async (
		manualWebContentsId?: number,
	): Promise<void> => {
		if (disposed) {
			return;
		}
		setState({ kind: "checking", enabled: true });
		try {
			const info = await provider.getLatestVersion();
			latestManifest = info;
			const current = app.getVersion();
			const isNewer = compareVersions(info.version, current) > 0;

			if (!isNewer) {
				setState({
					kind: "not-available",
					enabled: true,
					version: info.version,
				});
				sendCheckResult({
					status: "not-available",
					version: info.version,
					manualWebContentsId,
				});
				return;
			}

			setState({
				kind: "available",
				enabled: true,
				version: info.version,
				releaseNotes: info.releaseNotes,
			});
			sendCheckResult({
				status: "available",
				version: info.version,
				manualWebContentsId,
			});

			if (preferences.autoDownloadAndInstall) {
				await downloadUpdate();
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.warn("[auto-updater] check failed:", message);
			setState({ kind: "error", enabled: true, message });
			sendCheckResult({ status: "error", message, manualWebContentsId });
		}
	};

	const downloadUpdate = async (): Promise<void> => {
		if (disposed) {
			return;
		}
		const mod = resolveUpdaterModule();
		if (!mod) {
			setState({
				kind: "error",
				enabled: true,
				message: "electron-updater not installed; download unavailable",
			});
			return;
		}
		if (!latestManifest) {
			setState({
				kind: "error",
				enabled: true,
				message: "no manifest; run checkForUpdates first",
			});
			return;
		}
		try {
			setState({
				kind: "downloading",
				enabled: true,
				version: latestManifest.version,
				progress: 0,
			});
			await mod.autoUpdater.downloadUpdate();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error("[auto-updater] download failed:", message);
			setState({ kind: "error", enabled: true, message });
		}
	};

	const cancelDownload = async (): Promise<void> => {
		const mod = resolveUpdaterModule();
		if (!mod) {
			return;
		}
		try {
			mod.autoUpdater.cancelUpdate?.();
			setState({ kind: "idle", enabled: true });
		} catch (error) {
			logger.warn("[auto-updater] cancel failed:", error);
		}
	};

	const quitAndInstall = async (): Promise<void> => {
		const mod = resolveUpdaterModule();
		if (!mod) {
			setState({
				kind: "error",
				enabled: true,
				message: "electron-updater not installed; cannot install",
			});
			return;
		}
		setState({
			kind: "installing",
			enabled: true,
			version: latestManifest?.version ?? "",
		});
		try {
			mod.autoUpdater.quitAndInstall(false, true);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error("[auto-updater] quitAndInstall failed:", message);
			setState({ kind: "error", enabled: true, message });
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
		// Download/cancel/install actions converge on the command bus (B2); only the state and
		// preference queries keep a dedicated channel here.
		ipcMain.handle(PlatformChannels.GetUpdateState, () => state);
		ipcMain.handle(
			PlatformChannels.GetAutoUpdatePreferences,
			() => preferences,
		);
		ipcMain.handle(
			PlatformChannels.SetAutoDownloadAndInstallUpdates,
			(_e, enabled: unknown) => {
				preferences = {
					...preferences,
					autoDownloadAndInstall: Boolean(enabled),
				};
				writePreferences(preferences);
			},
		);
	};

	setUpdaterFeed();
	wireUpdaterEvents();
	registerIpc();

	return {
		checkForUpdates,
		downloadUpdate,
		cancelDownload,
		quitAndInstall,
		getState: () => state,
		getPreferences: () => preferences,
		setAutoDownloadAndInstall: async (enabled) => {
			preferences = { ...preferences, autoDownloadAndInstall: enabled };
			writePreferences(preferences);
		},
		startPolling: () => {
			if (pollTimer) {
				return;
			}
			schedulePoll();
		},
		stopPolling: () => {
			if (pollTimer) {
				clearTimeout(pollTimer);
				pollTimer = null;
			}
		},
		dispose: () => {
			disposed = true;
			if (pollTimer) {
				clearTimeout(pollTimer);
				pollTimer = null;
			}
			ipcMain.removeHandler(PlatformChannels.GetUpdateState);
			ipcMain.removeHandler(PlatformChannels.GetAutoUpdatePreferences);
			ipcMain.removeHandler(PlatformChannels.SetAutoDownloadAndInstallUpdates);
		},
	};
}

export const __test__ = {
	compareVersions,
	readPreferences,
	writePreferences,
	POLL_INTERVAL_MS,
	FOCUSED_POLL_INTERVAL_MS,
};
