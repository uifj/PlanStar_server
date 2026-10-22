import {
	type CaptureWindowScreenshotResult,
	type DesktopCommandId,
	DesktopCommandIds,
	type DesktopZoomState,
	type ExportLogsResult,
	isDesktopCommandId,
	type Locale,
	PlatformChannels,
} from "@harness/desktop-shared";
import { app, BrowserWindow, dialog, shell } from "electron";
import { logger } from "./logger";

/**
 * The command bus.
 *
 * Menus, keyboard shortcuts and programmatic renderer calls all end up here. Each case is thin:
 * either it acts on `senderWindow` directly (window controls), or it delegates to a subsystem
 * that owns its own state (feedback, export, update). Adding a command means adding one case
 * below; nothing else needs to know about it.
 *
 * Subsystems that live behind feature flags are reached through the `deps` object so this module
 * can be imported unconditionally and never blows up when a subsystem is not installed.
 */

export interface CommandHandlerDeps {
	/** Called for feedback / open-feedback-dialog command. Absent when the flag is off. */
	openFeedbackDialog?: () => Promise<void> | void;
	/** Called for capture-screenshot; returns `unsupported: true` when the flag is off. */
	captureScreenshot?: (
		win: BrowserWindow,
	) => Promise<CaptureWindowScreenshotResult> | CaptureWindowScreenshotResult;
	/** Called for export-logs; returns a disabled result when the flag is off. */
	exportLogs?: () => Promise<ExportLogsResult> | ExportLogsResult;
	/** Called for check-for-updates. Absent when auto-update is off. */
	checkForUpdates?: (manualWebContentsId?: number) => Promise<void> | void;
	downloadUpdate?: () => Promise<void> | void;
	cancelUpdateDownload?: () => Promise<void> | void;
	quitAndInstallUpdate?: () => Promise<void> | void;
	/** Called for locale changes so the menu can rebuild itself. */
	setApplicationLocale?: (locale: Locale) => void;
}

const ZOOM_MIN = -3;
const ZOOM_MAX = 5;

function clampZoom(level: number): number {
	if (!Number.isFinite(level)) {
		return 0;
	}
	return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
}

/**
 * Apply a zoom level and tell the renderer, so it can recompute layout. Main is the only place
 * that changes zoom (menu accelerators and renderer commands both land here), which makes this the
 * single producer for `DesktopZoomLevelChanged` — the renderer's `sidebar.resizePage` subscriber
 * was previously listening for a push that nothing ever sent.
 */
function applyZoom(win: BrowserWindow, next: number): number {
	const level = clampZoom(next);
	win.webContents.setZoomLevel(level);
	const payload: DesktopZoomState = { zoomLevel: level };
	win.webContents.send(PlatformChannels.DesktopZoomLevelChanged, payload);
	return level;
}

export type ExecuteDesktopCommand = (
	command: DesktopCommandId,
	senderWindow?: BrowserWindow | null,
	payload?: unknown,
) => Promise<unknown>;

export function createExecuteDesktopCommand(
	deps: CommandHandlerDeps,
): ExecuteDesktopCommand {
	return async (command, senderWindow, payload) => {
		if (!isDesktopCommandId(command)) {
			logger.warn("[command] unknown command id:", command);
			return { ok: false, reason: "unknown-command" };
		}

		const win = senderWindow ?? BrowserWindow.getFocusedWindow();

		try {
			switch (command) {
				case DesktopCommandIds.Reload:
					win?.webContents.reload();
					return { ok: true };

				case DesktopCommandIds.ForceReload:
					win?.webContents.reloadIgnoringCache();
					return { ok: true };

				case DesktopCommandIds.ToggleDevTools:
					if (win) {
						win.webContents.toggleDevTools();
					}
					return { ok: true };

				case DesktopCommandIds.ToggleFullScreen:
					if (win) {
						win.setFullScreen(!win.isFullScreen());
					}
					return { ok: true };

				case DesktopCommandIds.ZoomIn: {
					if (!win) {
						return { ok: false, reason: "no-window" };
					}
					const next = applyZoom(win, win.webContents.getZoomLevel() + 1);
					return { ok: true, zoomLevel: next };
				}

				case DesktopCommandIds.ZoomOut: {
					if (!win) {
						return { ok: false, reason: "no-window" };
					}
					const next = applyZoom(win, win.webContents.getZoomLevel() - 1);
					return { ok: true, zoomLevel: next };
				}

				case DesktopCommandIds.ResetZoom: {
					if (!win) {
						return { ok: false, reason: "no-window" };
					}
					return { ok: true, zoomLevel: applyZoom(win, 0) };
				}

				case DesktopCommandIds.Minimize:
					win?.minimize();
					return { ok: true };

				case DesktopCommandIds.Maximize:
					if (win) {
						if (win.isMaximized()) {
							win.unmaximize();
						} else {
							win.maximize();
						}
					}
					return { ok: true };

				case DesktopCommandIds.Close:
					win?.close();
					return { ok: true };

				case DesktopCommandIds.CheckForUpdates: {
					if (!deps.checkForUpdates) {
						return { ok: false, reason: "auto-update-disabled" };
					}
					await deps.checkForUpdates(win?.webContents.id);
					return { ok: true };
				}

				case DesktopCommandIds.DownloadUpdate: {
					if (!deps.downloadUpdate) {
						return { ok: false, reason: "auto-update-disabled" };
					}
					await deps.downloadUpdate();
					return { ok: true };
				}

				case DesktopCommandIds.CancelUpdateDownload: {
					if (!deps.cancelUpdateDownload) {
						return { ok: false, reason: "auto-update-disabled" };
					}
					await deps.cancelUpdateDownload();
					return { ok: true };
				}

				case DesktopCommandIds.QuitAndInstallUpdate: {
					if (!deps.quitAndInstallUpdate) {
						return { ok: false, reason: "auto-update-disabled" };
					}
					await deps.quitAndInstallUpdate();
					return { ok: true };
				}

				case DesktopCommandIds.ExportLogs: {
					if (!deps.exportLogs) {
						return {
							success: false,
							error: "disabled",
						} satisfies ExportLogsResult;
					}
					return await deps.exportLogs();
				}

				case DesktopCommandIds.OpenFeedback: {
					if (!deps.openFeedbackDialog) {
						return { ok: false, reason: "feedback-disabled" };
					}
					await deps.openFeedbackDialog();
					return { ok: true };
				}

				case DesktopCommandIds.CaptureScreenshot: {
					if (!win || !deps.captureScreenshot) {
						return {
							png: "",
							width: 0,
							height: 0,
							unsupported: true,
						} satisfies CaptureWindowScreenshotResult;
					}
					return await deps.captureScreenshot(win);
				}

				case DesktopCommandIds.ShowAbout: {
					const version = app.getVersion();
					const electron = process.versions.electron;
					const chrome = process.versions.chrome;
					const node = process.versions.node;
					await dialog.showMessageBox(win ?? undefined!, {
						type: "info",
						title: app.name,
						message: app.name,
						detail: `Version ${version}\nElectron ${electron} · Chrome ${chrome} · Node ${node}`,
						buttons: ["OK"],
					});
					return { ok: true };
				}

				case DesktopCommandIds.OpenExternal: {
					const url = typeof payload === "string" ? payload : null;
					if (!url || !/^https?:\/\//i.test(url)) {
						return { ok: false, reason: "invalid-url" };
					}
					await shell.openExternal(url);
					return { ok: true };
				}

				default: {
					// Exhaustiveness guard: if a new command id is added and no case handles it,
					// TypeScript flags this line at build time.
					const _exhaustive: never = command;
					logger.warn("[command] unhandled command:", _exhaustive);
					return { ok: false, reason: "unhandled" };
				}
			}
		} catch (error) {
			logger.error("[command] handler threw:", command, error);
			return {
				ok: false,
				reason: "error",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	};
}
