/**
 * Command IDs for the desktop command bus.
 *
 * Menus, keyboard shortcuts and programmatic renderer calls all funnel through
 * `executeDesktopCommand(id)` so a single handler decides what a command does; the sender only
 * names it. Adding a new command means: add an ID here, wire a case in `main/commandHandlers.ts`,
 * expose it through the menu (or shortcut table) — nothing else changes.
 *
 * Values are stable strings; renaming one is a breaking change for any shortcut override that
 * references it.
 */

import type { CaptureWindowScreenshotResult, ExportLogsResult } from "./types";
export const DesktopCommandIds = {
	Reload: "reload",
	ForceReload: "force-reload",
	ToggleDevTools: "toggle-dev-tools",
	ToggleFullScreen: "toggle-full-screen",

	ZoomIn: "zoom-in",
	ZoomOut: "zoom-out",
	ResetZoom: "reset-zoom",

	Minimize: "minimize",
	Maximize: "maximize",
	Close: "close",

	CheckForUpdates: "check-for-updates",
	DownloadUpdate: "download-update",
	CancelUpdateDownload: "cancel-update-download",
	QuitAndInstallUpdate: "quit-and-install-update",

	ExportLogs: "export-logs",
	OpenFeedback: "open-feedback",
	CaptureScreenshot: "capture-screenshot",

	ShowAbout: "show-about",
	OpenExternal: "open-external",
} as const;

export type DesktopCommandId =
	(typeof DesktopCommandIds)[keyof typeof DesktopCommandIds];

/**
 * This package compiles under its own ES2020 lib and consumers only see the emitted `.d.ts`, so
 * the runtime is free to use modern built-ins like `Object.values` — the old ES5 constraint (from
 * when the renderer imported this source directly through the `DesktopShared` alias) no longer
 * applies now that the contract ships as a built package.
 */
export function isDesktopCommandId(value: unknown): value is DesktopCommandId {
	if (typeof value !== "string") {
		return false;
	}
	return (Object.values(DesktopCommandIds) as string[]).includes(value);
}

/**
 * Commands whose reply is a typed payload rather than the generic acknowledgement. Everything not
 * listed here answers `DesktopCommandAck`, so adding a command keeps working without touching
 * this map; only the ones that return a real result need an entry.
 */
export interface DesktopCommandResults {
	[DesktopCommandIds.ExportLogs]: ExportLogsResult;
	[DesktopCommandIds.CaptureScreenshot]: CaptureWindowScreenshotResult;
}

/** The `{ ok, reason?, zoomLevel? }` envelope every action command answers with. */
export interface DesktopCommandAck {
	ok: boolean;
	reason?: string;
	zoomLevel?: number;
}

/**
 * Reply type per command id. This is what removes the `as Promise<ExportLogsResult>` casts from
 * the renderer facade: the wire is cast once, at the preload boundary, and every caller afterwards
 * is typed from the command id alone.
 */
export type DesktopCommandResult<K extends DesktopCommandId> =
	K extends keyof DesktopCommandResults
		? DesktopCommandResults[K]
		: DesktopCommandAck;
