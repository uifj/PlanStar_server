import type { DesktopCommandId } from "./commands";
import type {
	AutoUpdatePreferences,
	DesktopCapabilities,
	DesktopZoomState,
	ForceUpdateRequiredPayload,
	Locale,
	LogLevel,
	PostUpdateReleaseNotesPayload,
	SubmitFeedbackPayload,
	SubmitFeedbackResult,
	UpdateCheckResultPayload,
	UpdateStatePayload,
} from "./types";

/** Disposer returned by every `on*` subscription. */
export type DesktopUnsubscribe = () => void;

/**
 * The wire shape of the `window.Desktop` bridge — the single source of truth for the contract
 * between the Electron preload (`electron/preload/bridge.ts`, which narrows `isDesktop` to `true`
 * and `platform` to `NodeJS.Platform`) and the renderer facade (`src/ts/lib/desktop.ts`, which
 * wraps each call so web mode / rejections degrade to `null`).
 *
 * Extracted here (A2) so neither side hand-maintains a duplicate interface: a method added to the
 * bridge is a typecheck error in the facade until it is mirrored, and the parity script covers the
 * web mock. Pure types only — this file must never import `electron`.
 */
export interface DesktopBridgeApi {
	// Identity.
	readonly isDesktop: boolean;
	readonly platform: string;
	readonly electronVersion: string;
	readonly chromeVersion: string;

	// Command bus.
	executeCommand(id: DesktopCommandId, payload?: unknown): Promise<unknown>;

	// Logging.
	log(level: LogLevel, args: unknown[]): void;

	// Capabilities (feature-flag snapshot).
	getCapabilities(): Promise<DesktopCapabilities>;

	// Locale & zoom.
	setApplicationLocale(locale: Locale): void;
	getSystemLocale(): Promise<Locale>;
	getZoomLevel(): Promise<DesktopZoomState>;
	onApplicationLocaleChanged(
		callback: (locale: Locale) => void,
	): DesktopUnsubscribe;
	onZoomLevelChanged(
		callback: (state: DesktopZoomState) => void,
	): DesktopUnsubscribe;

	// Feedback. Screenshot capture converges on the command bus (B2); submitFeedback stays a
	// direct method because it carries a payload and has no command id.
	submitFeedback(payload: SubmitFeedbackPayload): Promise<SubmitFeedbackResult>;
	onOpenFeedbackDialog(callback: () => void): DesktopUnsubscribe;

	// Auto-update. State and preferences are queries; the download/cancel/install actions and log
	// export converge on the command bus (B2) so main has a single dispatch point for every action.
	getUpdateState(): Promise<UpdateStatePayload>;
	getAutoUpdatePreferences(): Promise<AutoUpdatePreferences>;
	setAutoDownloadAndInstallUpdates(enabled: boolean): Promise<void>;
	onUpdateStateChanged(
		callback: (state: UpdateStatePayload) => void,
	): DesktopUnsubscribe;
	onUpdateCheckResult(
		callback: (result: UpdateCheckResultPayload) => void,
	): DesktopUnsubscribe;
	onPostUpdateReleaseNotes(
		callback: (payload: PostUpdateReleaseNotesPayload) => void,
	): DesktopUnsubscribe;
	onForceUpdateRequired(
		callback: (payload: ForceUpdateRequiredPayload) => void,
	): DesktopUnsubscribe;

	// Renderer boot acknowledgement.
	notifyRendererReady(): void;
}
