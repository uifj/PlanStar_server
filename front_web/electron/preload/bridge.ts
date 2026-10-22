import {
	type DesktopBridgeApi,
	type DesktopCapabilities,
	type DesktopCommandId,
	type DesktopCommandResult,
	type DesktopZoomState,
	type ForceUpdateClearedPayload,
	type ForceUpdateRequiredPayload,
	isDesktopCommandId,
	type Locale,
	type LogPayload,
	normalizeLocale,
	PlatformChannels,
	type SubmitFeedbackResult,
	type UpdateCheckResultPayload,
	type UpdateStatePayload,
} from "@harness/desktop-shared";
import { contextBridge, ipcRenderer } from "electron";

/**
 * The renderer-facing facade, exposed as `window.Desktop`.
 *
 * The full method surface lives in `DesktopBridgeApi` (`@harness/desktop-shared`), the single wire
 * contract shared with the renderer facade so neither side hand-maintains a duplicate interface
 * (A2). This narrowing only pins the two identity fields the preload can guarantee: it always runs
 * inside Electron, so `isDesktop` is the literal `true` and `platform` is Node's platform union
 * rather than the loose `string` the wire contract allows for the web mock.
 *
 * Design notes (see plan §5.1):
 *   - Every main → renderer push is delivered through a subscription helper that supports
 *     "replay latest" so a late-mounting React effect never misses a one-shot event.
 *   - The existing `desktop:route` push from `main.ts` keeps its old channel name for
 *     backward compatibility with the current preload; the new channel constant is added but
 *     the wire format is unchanged.
 */

type Unsubscribe = () => void;

/**
 * A tiny event-bus over `ipcRenderer.on`. Keeps the "callback Set + replay-latest" pattern ZCode
 * uses in its preload so subscribers that mount after a one-shot push still see the last value.
 */
function createSubscriber<T>(
	channel: string,
	options?: { replayLatest?: boolean },
) {
	const callbacks = new Set<(payload: T) => void>();
	let latest: T | null = null;
	let hasLatest = false;

	ipcRenderer.on(channel, (_event: unknown, payload: T) => {
		if (options?.replayLatest) {
			latest = payload;
			hasLatest = true;
		}
		for (const callback of callbacks) {
			try {
				callback(payload);
			} catch (error) {
				// A throwing subscriber must not prevent the rest from receiving the event.
				console.error("[Desktop bridge] subscriber threw on", channel, error);
			}
		}
	});

	return function subscribe(callback: (payload: T) => void): Unsubscribe {
		callbacks.add(callback);
		if (options?.replayLatest && hasLatest && latest !== null) {
			try {
				callback(latest);
			} catch (error) {
				console.error(
					"[Desktop bridge] replay-latest threw on",
					channel,
					error,
				);
			}
		}
		return () => {
			callbacks.delete(callback);
		};
	};
}

// Subscriptions the bridge owns. Each is created once at module load so ipcRenderer has a single
// listener per channel regardless of how many React components subscribe.
const subscribeUpdateState = createSubscriber<UpdateStatePayload>(
	PlatformChannels.UpdateStateChanged,
	{ replayLatest: true },
);
const subscribeUpdateCheckResult = createSubscriber<UpdateCheckResultPayload>(
	PlatformChannels.UpdateCheckResult,
);
const subscribeOpenFeedback = createSubscriber<void>(
	PlatformChannels.OpenFeedbackDialog,
);
// No replay: the renderer applies the locale at boot from `getSystemLocale()`, and a replayed
// value would re-trigger a redundant locale switch on every late subscription.
const subscribeApplicationLocaleChanged = createSubscriber<Locale>(
	PlatformChannels.ApplicationLocaleChanged,
	{ replayLatest: false },
);
const subscribeZoomLevelChanged = createSubscriber<DesktopZoomState>(
	PlatformChannels.DesktopZoomLevelChanged,
	{ replayLatest: true },
);
const subscribeForceUpdateRequired =
	createSubscriber<ForceUpdateRequiredPayload>(
		PlatformChannels.ForceUpdateRequired,
		{ replayLatest: true },
	);
// No replay: a cleared event is a one-shot transition. Replaying it on a late mount would close a
// modal that a *new* forced release had already opened.
const subscribeForceUpdateCleared = createSubscriber<ForceUpdateClearedPayload>(
	PlatformChannels.ForceUpdateCleared,
	{ replayLatest: false },
);

/**
 * Deep links were already delivered as `desktop:route` before this refactor and the existing
 * renderer route-sync listens for the raw ipcRenderer event rather than a facade method. The
 * listener is kept inline here so `preload.ts` stays a one-file assembly; the behavior is
 * identical to the pre-refactor `preload.ts`.
 */
ipcRenderer.on(
	PlatformChannels.DesktopRoute,
	(_event: unknown, route: unknown) => {
		if (typeof route !== "string" || !route.startsWith("/")) {
			return;
		}
		window.history.pushState({ route }, "", route);
		window.dispatchEvent(new PopStateEvent("popstate", { state: { route } }));
	},
);

export interface DesktopBridge extends DesktopBridgeApi {
	// Identity narrowed for the real shell (see the doc comment above).
	readonly isDesktop: true;
	readonly platform: NodeJS.Platform;
}

export const desktopBridge: DesktopBridge = {
	isDesktop: true,
	platform: process.platform,
	electronVersion: process.versions.electron,
	chromeVersion: process.versions.chrome,

	executeCommand<K extends DesktopCommandId>(
		id: K,
		payload?: unknown,
	): Promise<DesktopCommandResult<K>> {
		if (!isDesktopCommandId(id)) {
			return Promise.reject(
				new Error(`Unknown desktop command: ${String(id)}`),
			);
		}
		// The wire answer is `unknown`: main dispatches every command through one handler, so the
		// per-command shape is only guaranteed by `DesktopCommandResults` on both sides.
		return ipcRenderer.invoke(
			PlatformChannels.ExecuteDesktopCommand,
			id,
			payload,
		) as Promise<DesktopCommandResult<K>>;
	},

	log(level, args) {
		const payload: LogPayload = { level, args };
		ipcRenderer.send(PlatformChannels.Log, payload);
	},

	getCapabilities() {
		return ipcRenderer.invoke(
			PlatformChannels.GetCapabilities,
		) as Promise<DesktopCapabilities>;
	},

	setApplicationLocale(locale) {
		ipcRenderer.send(
			PlatformChannels.SetApplicationLocale,
			normalizeLocale(locale),
		);
	},
	getSystemLocale() {
		return ipcRenderer
			.invoke(PlatformChannels.GetSystemLocale)
			.then((value: unknown) => normalizeLocale(value));
	},
	getZoomLevel() {
		return ipcRenderer.invoke(
			PlatformChannels.GetDesktopZoomLevel,
		) as Promise<DesktopZoomState>;
	},
	onApplicationLocaleChanged(callback) {
		return subscribeApplicationLocaleChanged((locale) =>
			callback(normalizeLocale(locale)),
		);
	},
	onZoomLevelChanged: subscribeZoomLevelChanged,

	submitFeedback(payload) {
		return ipcRenderer.invoke(
			PlatformChannels.SubmitFeedback,
			payload,
		) as Promise<SubmitFeedbackResult>;
	},
	onOpenFeedbackDialog(callback) {
		return subscribeOpenFeedback(() => callback());
	},

	getUpdateState() {
		return ipcRenderer.invoke(
			PlatformChannels.GetUpdateState,
		) as Promise<UpdateStatePayload>;
	},
	onUpdateStateChanged: subscribeUpdateState,
	onUpdateCheckResult: subscribeUpdateCheckResult,
	onForceUpdateRequired: subscribeForceUpdateRequired,
	getForceUpdateState() {
		return ipcRenderer.invoke(
			PlatformChannels.GetForceUpdateState,
		) as Promise<ForceUpdateRequiredPayload | null>;
	},
	onForceUpdateCleared: subscribeForceUpdateCleared,

	notifyRendererReady() {
		ipcRenderer.send(PlatformChannels.RendererReady);
	},
};

/**
 * Install the bridge onto `window.Desktop`. Called from `preload.ts` so the entry stays a single
 * obvious line and tests can import `desktopBridge` without touching `contextBridge`.
 */
export function installDesktopBridge(): void {
	contextBridge.exposeInMainWorld("Desktop", desktopBridge);
}
