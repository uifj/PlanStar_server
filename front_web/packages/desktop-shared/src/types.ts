/**
 * Cross-process payload types shared by main, preload, and (through the facade) the renderer.
 *
 * Kept deliberately small: anything the renderer needs to reason about lives here, everything
 * else stays inside `main/`. Do not import Electron types into this file — the renderer reads it
 * through the preload bridge, and Electron types would drag `electron` into the browser bundle.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogPayload {
	level: LogLevel;
	args: unknown[];
}

export interface DesktopZoomState {
	zoomLevel: number;
}

export type Locale = "en-US" | "zh-CN";

export const DEFAULT_LOCALE: Locale = "en-US";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en-US", "zh-CN"];

export function normalizeLocale(value: unknown): Locale {
	if (typeof value !== "string") {
		return DEFAULT_LOCALE;
	}
	const lowered = value.toLowerCase();
	if (lowered.startsWith("zh")) {
		return "zh-CN";
	}
	return DEFAULT_LOCALE;
}

/** Discriminated union so the UI can switch on `kind` without narrowing every optional field. */
export type UpdateStatePayload =
	| { kind: "idle"; enabled: boolean }
	| { kind: "checking"; enabled: boolean }
	| {
			kind: "available";
			enabled: boolean;
			version: string;
			releaseNotes?: string;
	  }
	| { kind: "not-available"; enabled: boolean; version: string }
	| { kind: "downloading"; enabled: boolean; version: string; progress: number }
	| {
			kind: "update-downloaded";
			enabled: boolean;
			version: string;
			releaseNotes?: string;
	  }
	| { kind: "installing"; enabled: boolean; version: string }
	| { kind: "error"; enabled: boolean; message: string };

export interface UpdateCheckResultPayload {
	/** Present when the manual check was answered; absent means "no result yet". */
	status: "available" | "not-available" | "error" | "skipped";
	version?: string;
	message?: string;
	/** Web contents that initiated the manual check, so main can echo the result back. */
	manualWebContentsId?: number;
}

export interface PostUpdateReleaseNotesPayload {
	version: string;
	releaseNotes?: string;
	acknowledged: boolean;
}

export interface CaptureWindowScreenshotResult {
	png: string;
	width: number;
	height: number;
	/** Set when the current environment cannot capture (Web mock, off-screen window, etc). */
	unsupported?: boolean;
}

export interface ExportLogsResult {
	success: boolean;
	path?: string;
	error?: string;
}

export interface AutoUpdatePreferences {
	autoDownloadAndInstall: boolean;
	skippedVersions: string[];
}

export interface ForceUpdateRequiredPayload {
	version: string;
	releaseNotes?: string;
}

/** Renderer → main feedback submission. `png` is the base64 screenshot from `captureScreenshot`. */
export interface SubmitFeedbackPayload {
	text: string;
	email?: string;
	attachScreenshot?: boolean;
	png?: string;
	width?: number;
	height?: number;
	locale?: string;
	appVersion?: string;
}

export interface SubmitFeedbackResult {
	success: boolean;
	/** Directory under userData/feedback where the report was persisted. */
	path?: string;
	error?: string;
}

/**
 * Read-only snapshot of which desktop capabilities are actually enabled in the running shell,
 * derived from the main-process feature flags. The renderer queries this once at boot (through
 * `desktop.capabilities()`) so UI can hide entries for subsystems that are flagged off, instead of
 * calling a method and inferring "disabled" from a `null`/failure. In web mode every shell-only
 * capability reports false while `isDesktop` distinguishes the browser from the real shell.
 */
export interface DesktopCapabilities {
	readonly isDesktop: boolean;
	readonly feedback: boolean;
	readonly exportLogs: boolean;
	readonly notifications: boolean;
	readonly tray: boolean;
	readonly autoUpdate: boolean;
	readonly crashReporter: boolean;
	readonly forceUpdate: boolean;
}
