/**
 * Renderer-side facade over the `window.Desktop` bridge installed by the Electron preload.
 *
 * This is the single place renderer code talks to the desktop shell — components never touch
 * `window.Desktop` directly, mirroring how ZCode's renderer consumes `IPlatformService` through
 * `desktopPlatform.ts` instead of `window.zcode`.
 *
 * Design rules:
 *   - Every contract type/constant comes from `@harness/desktop-shared`, so main,
 *     preload and renderer compile against the same definitions; a renamed channel or command
 *     is a typecheck error on both sides.
 *   - One bridge in both modes: the Electron preload installs the real `window.Desktop`, and the
 *     web entry installs a mock `window.Desktop` (isDesktop: false) forwarding to electronMock's
 *     parity handlers. So the facade is live in the browser too; `isShell()` — not the presence of
 *     a bridge — is what distinguishes the real shell. A call still degrades to `null` when no
 *     bridge exists at all (e.g. unit tests) or the IPC invoke rejects (flag off → no handler).
 *   - The legacy `Renderer.send('updateCheck')` string protocol still works through
 *     electronMock; new code should use this facade.
 */

import {
	type AutoUpdatePreferences,
	type CaptureWindowScreenshotResult,
	type DesktopBridgeApi,
	type DesktopCapabilities,
	type DesktopCommandId,
	DesktopCommandIds,
	type DesktopZoomState,
	type ExportLogsResult,
	type ForceUpdateRequiredPayload,
	type Locale,
	type LogLevel,
	type PostUpdateReleaseNotesPayload,
	type SubmitFeedbackPayload,
	type SubmitFeedbackResult,
	type UpdateCheckResultPayload,
	type UpdateStatePayload,
} from "@harness/desktop-shared";

export type Unsubscribe = () => void;

declare global {
	interface Window {
		Desktop?: DesktopBridgeApi;
	}
}

const noopUnsubscribe: Unsubscribe = () => {};

function bridge(): DesktopBridgeApi | null {
	if (typeof window === "undefined") {
		return null;
	}
	// Presence-based: the real preload bridge (isDesktop: true) and the web mock (isDesktop: false)
	// both count, so the facade is live in either mode. Use `desktop.isShell()` to tell them apart.
	return window.Desktop ?? null;
}

/**
 * Wrap a bridge call so web mode resolves to `null` instead of throwing, and a rejected IPC
 * invoke (e.g. flag disabled → no handler registered in main) degrades to `null` as well.
 */
function invoke<T>(
	run: (api: DesktopBridgeApi) => Promise<T>,
): Promise<T | null> {
	const api = bridge();
	if (!api) {
		return Promise.resolve(null);
	}
	try {
		return run(api).catch((error) => {
			console.warn("[desktop] bridge call failed:", error);
			return null;
		});
	} catch (error) {
		console.warn("[desktop] bridge call threw:", error);
		return Promise.resolve(null);
	}
}

/**
 * Adapt a command-bus result to the `void | null` sentinel the update actions have always used:
 * `{ ok: true }` → `undefined` (ran), everything else → `null` (could not run). The command bus
 * answers a disabled flag with `{ ok: false, reason }` and `invoke` answers a missing bridge or a
 * rejected IPC with `null`, so both collapse to the same "unavailable" sentinel callers already
 * check (e.g. `forceUpdate.tsx`'s `result === null`).
 */
function toVoidOrNull(result: unknown): void | null {
	return result !== null &&
		typeof result === "object" &&
		(result as { ok?: unknown }).ok === true
		? undefined
		: null;
}

function subscribe<T>(
	attach: (
		api: DesktopBridgeApi,
		callback: (payload: T) => void,
	) => Unsubscribe,
	callback: (payload: T) => void,
): Unsubscribe {
	const api = bridge();
	if (!api) {
		return noopUnsubscribe;
	}
	try {
		return attach(api, callback) || noopUnsubscribe;
	} catch (error) {
		console.warn("[desktop] subscribe failed:", error);
		return noopUnsubscribe;
	}
}

export const desktop = {
	/** True only inside the real Electron shell (the preload bridge), not the web mock. */
	isShell(): boolean {
		return bridge()?.isDesktop === true;
	},

	/** Shell identity fields; `null` in web mode. */
	platform(): string | null {
		return bridge()?.platform ?? null;
	},
	shellVersion(): string | null {
		return bridge()?.electronVersion ?? null;
	},

	/**
	 * Feature-flag snapshot from the shell (B1). Resolves to `null` in web mode / when no bridge
	 * exists, so callers treat `null` as "capabilities unknown" and hide shell-only entries rather
	 * than guessing. Query once at boot and cache — the shell never re-reads flags at runtime.
	 */
	capabilities(): Promise<DesktopCapabilities | null> {
		return invoke((api) => api.getCapabilities());
	},

	/**
	 * Tell main the renderer finished booting so it can flush a deep-link route that arrived
	 * before the window existed. Safe to call unconditionally at app init.
	 */
	notifyRendererReady(): void {
		bridge()?.notifyRendererReady();
	},

	log(level: LogLevel, ...args: unknown[]): void {
		const api = bridge();
		if (api) {
			api.log(level, args);
		}
	},

	executeCommand(
		id: DesktopCommandId,
		payload?: unknown,
	): Promise<unknown | null> {
		return invoke((api) => api.executeCommand(id, payload));
	},

	checkForUpdates(): Promise<unknown | null> {
		return this.executeCommand(DesktopCommandIds.CheckForUpdates);
	},

	exportLogs(): Promise<ExportLogsResult | null> {
		return this.executeCommand(
			DesktopCommandIds.ExportLogs,
		) as Promise<ExportLogsResult | null>;
	},

	captureScreenshot(): Promise<CaptureWindowScreenshotResult | null> {
		return this.executeCommand(
			DesktopCommandIds.CaptureScreenshot,
		) as Promise<CaptureWindowScreenshotResult | null>;
	},

	submitFeedback(
		payload: SubmitFeedbackPayload,
	): Promise<SubmitFeedbackResult | null> {
		return invoke((api) => api.submitFeedback(payload));
	},

	setApplicationLocale(locale: Locale): void {
		bridge()?.setApplicationLocale(locale);
	},
	getSystemLocale(): Promise<Locale | null> {
		return invoke((api) => api.getSystemLocale());
	},
	getZoomLevel(): Promise<DesktopZoomState | null> {
		return invoke((api) => api.getZoomLevel());
	},

	getUpdateState(): Promise<UpdateStatePayload | null> {
		return invoke((api) => api.getUpdateState());
	},
	// `void | null` is intentional: `null` means "no shell / flag off / invoke rejected" and is
	// checked by callers (e.g. forceUpdate popup), while `void` is the adapted success return
	// (`{ ok: true }` from the command bus). These actions ride the command bus (B2).
	// biome-ignore lint/suspicious/noConfusingVoidType: documented sentinel union above
	downloadUpdate(): Promise<void | null> {
		return this.executeCommand(DesktopCommandIds.DownloadUpdate).then(
			toVoidOrNull,
		);
	},
	// biome-ignore lint/suspicious/noConfusingVoidType: same sentinel union as downloadUpdate
	cancelUpdateDownload(): Promise<void | null> {
		return this.executeCommand(DesktopCommandIds.CancelUpdateDownload).then(
			toVoidOrNull,
		);
	},
	// biome-ignore lint/suspicious/noConfusingVoidType: same sentinel union as downloadUpdate
	quitAndInstallUpdate(): Promise<void | null> {
		return this.executeCommand(DesktopCommandIds.QuitAndInstallUpdate).then(
			toVoidOrNull,
		);
	},
	getAutoUpdatePreferences(): Promise<AutoUpdatePreferences | null> {
		return invoke((api) => api.getAutoUpdatePreferences());
	},
	// biome-ignore lint/suspicious/noConfusingVoidType: same sentinel union as downloadUpdate
	setAutoDownloadAndInstallUpdates(enabled: boolean): Promise<void | null> {
		return invoke((api) => api.setAutoDownloadAndInstallUpdates(enabled));
	},

	// Subscriptions. Each returns an unsubscribe function; web mode returns a no-op.
	onUpdateStateChanged(
		callback: (state: UpdateStatePayload) => void,
	): Unsubscribe {
		return subscribe((api, cb) => api.onUpdateStateChanged(cb), callback);
	},
	onUpdateCheckResult(
		callback: (result: UpdateCheckResultPayload) => void,
	): Unsubscribe {
		return subscribe((api, cb) => api.onUpdateCheckResult(cb), callback);
	},
	onPostUpdateReleaseNotes(
		callback: (payload: PostUpdateReleaseNotesPayload) => void,
	): Unsubscribe {
		return subscribe((api, cb) => api.onPostUpdateReleaseNotes(cb), callback);
	},
	onOpenFeedbackDialog(callback: () => void): Unsubscribe {
		return subscribe<void>((api, cb) => api.onOpenFeedbackDialog(cb), callback);
	},
	onForceUpdateRequired(
		callback: (payload: ForceUpdateRequiredPayload) => void,
	): Unsubscribe {
		return subscribe((api, cb) => api.onForceUpdateRequired(cb), callback);
	},
	onApplicationLocaleChanged(callback: (locale: Locale) => void): Unsubscribe {
		return subscribe((api, cb) => api.onApplicationLocaleChanged(cb), callback);
	},
	onZoomLevelChanged(callback: (state: DesktopZoomState) => void): Unsubscribe {
		return subscribe((api, cb) => api.onZoomLevelChanged(cb), callback);
	},
};

export type {
	AutoUpdatePreferences,
	CaptureWindowScreenshotResult,
	DesktopBridgeApi,
	DesktopCapabilities,
	DesktopCommandId,
	DesktopZoomState,
	ExportLogsResult,
	ForceUpdateRequiredPayload,
	Locale,
	LogLevel,
	PostUpdateReleaseNotesPayload,
	SubmitFeedbackPayload,
	SubmitFeedbackResult,
	UpdateCheckResultPayload,
	UpdateStatePayload,
};
// Re-export the contract so renderer code has one import site for everything desktop-related.
export { DesktopCommandIds };
