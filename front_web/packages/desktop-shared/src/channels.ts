/**
 * IPC channel names shared by the main process, preload bridge, and (indirectly) the renderer.
 *
 * Values are kebab-case strings so DevTools' IPC panes stay readable; the constant names are
 * PascalCase to mirror the ZCode `PlatformChannels` shape this file is modelled after.
 *
 * Every channel is namespaced by direction so it is obvious at a glance who owns the wire:
 *   - `desktop:*`         main → renderer push (fire and forget)
 *   - `desktop-invoke:*`  renderer → main request/response (ipcRenderer.invoke)
 *   - `desktop-send:*`    renderer → main one-way (ipcRenderer.send)
 */
export const PlatformChannels = {
	// renderer → main, one-way
	Log: "desktop-send:log",
	RendererReady: "desktop-send:renderer-ready",
	SetApplicationLocale: "desktop-send:set-application-locale",

	// renderer → main, request/response
	// Actions (export-logs, capture-screenshot, download/cancel/install-update) all funnel through
	// ExecuteDesktopCommand (B2); only queries and payload-bearing submissions keep a dedicated
	// channel here.
	ExecuteDesktopCommand: "desktop-invoke:execute-command",
	SubmitFeedback: "desktop-invoke:submit-feedback",
	GetUpdateState: "desktop-invoke:get-update-state",
	GetAutoUpdatePreferences: "desktop-invoke:get-auto-update-preferences",
	SetAutoDownloadAndInstallUpdates: "desktop-invoke:set-auto-download-updates",
	GetDesktopZoomLevel: "desktop-invoke:get-zoom-level",
	GetSystemLocale: "desktop-invoke:get-system-locale",
	GetCapabilities: "desktop-invoke:get-capabilities",

	// main → renderer, push
	DesktopRoute: "desktop:route",
	OpenFeedbackDialog: "desktop:open-feedback-dialog",
	UpdateStateChanged: "desktop:update-state-changed",
	UpdateCheckResult: "desktop:update-check-result",
	PostUpdateReleaseNotes: "desktop:post-update-release-notes",
	ForceUpdateRequired: "desktop:force-update-required",
	ApplicationLocaleChanged: "desktop:application-locale-changed",
	DesktopZoomLevelChanged: "desktop:zoom-level-changed",
} as const;

export type PlatformChannel =
	(typeof PlatformChannels)[keyof typeof PlatformChannels];
