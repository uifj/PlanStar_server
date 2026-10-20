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
