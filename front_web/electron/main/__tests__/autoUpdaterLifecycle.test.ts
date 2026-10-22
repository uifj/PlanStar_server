import { PlatformChannels } from "@harness/desktop-shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lifecycle behaviour of the auto-update controller that the renderer can observe only
 * indirectly. Three fixes are pinned here:
 *   1. `startPolling` checks immediately instead of waiting a full interval, so a forced release
 *      published overnight is noticed at launch;
 *   2. a background poll must not overwrite the window id a manual "Check for updates" registered,
 *      or the spinner resolves against the wrong request;
 *   3. `announceIfForced` must not retract on a network blip, and must retract when the policy no
 *      longer forces the version — that is the only place a withdrawn flag is noticed.
 */

type Listener = (...args: unknown[]) => void;

const updater = vi.hoisted(() => {
	const listeners = new Map<string, Listener>();
	return {
		listeners,
		autoDownload: false,
		autoInstallOnAppQuit: false,
		allowPrerelease: false,
		logger: null as unknown,
		currentVersion: { version: "0.0.0" },
		setFeedURL: () => undefined,
		on: (event: string, listener: Listener) => {
			listeners.set(event, listener);
		},
		removeAllListeners: () => {
			listeners.clear();
		},
		checkForUpdates: () =>
			Promise.resolve({ cancellationToken: null, downloadPromise: null }),
		downloadUpdate: () => Promise.resolve(),
		quitAndInstall: () => undefined,
	};
});

const ipc = vi.hoisted(() => {
	const handlers = new Map<string, Listener>();
	return {
		handlers,
		handle: (channel: string, listener: Listener) => {
			handlers.set(channel, listener);
		},
		removeHandler: (channel: string) => {
			handlers.delete(channel);
		},
	};
});

const windows = vi.hoisted(() => ({
	getAllWindows: () => [] as unknown[],
}));

const renderers = vi.hoisted(() => {
	const sent: { channel: string; payload: unknown }[] = [];
	return {
		sent,
		fromId: (id: number) => ({
			id,
			isDestroyed: () => false,
			send: (channel: string, payload: unknown) => {
				sent.push({ channel, payload });
			},
		}),
	};
});

vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows: windows.getAllWindows },
	ipcMain: { handle: ipc.handle, removeHandler: ipc.removeHandler },
	webContents: { fromId: renderers.fromId },
}));

vi.mock("electron-updater", () => ({
	autoUpdater: updater,
	CancellationToken: class {
		cancel(): void {
			// no-op
		}
	},
}));

import { initAutoUpdater } from "../autoUpdater";

/** Let the `await`-ed policy-manifest lookup inside `announceIfForced` resolve. */
const flush = (): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, 0);
	});

function checkUpdatesCallCount(): number {
	return vi.mocked(updater.checkForUpdates).mock.calls.length;
}

describe("autoUpdater lifecycle", () => {
	beforeEach(() => {
		updater.listeners.clear();
		updater.checkForUpdates = vi.fn(() =>
			Promise.resolve({ cancellationToken: null, downloadPromise: null }),
		);
		ipc.handlers.clear();
		renderers.sent.length = 0;
		vi.useRealTimers();
	});

	describe("polling", () => {
		it("checks for updates immediately when polling starts", () => {
			const controller = initAutoUpdater({
				fetchPolicyManifest: () => Promise.resolve(null),
			});

			expect(checkUpdatesCallCount()).toBe(0);
			controller.startPolling();
			expect(checkUpdatesCallCount()).toBe(1);

			controller.dispose();
		});

		it("starts one loop, not one per startPolling call", () => {
			const controller = initAutoUpdater({
				fetchPolicyManifest: () => Promise.resolve(null),
			});

			controller.startPolling();
			controller.startPolling();
			expect(checkUpdatesCallCount()).toBe(1);

			controller.dispose();
		});

		it("stops scheduling once disposed", async () => {
			const controller = initAutoUpdater({
				fetchPolicyManifest: () => Promise.resolve(null),
			});

			controller.startPolling();
			controller.dispose();
			await flush();

			// Nothing may fire after dispose, even though the first check was still in flight.
			expect(checkUpdatesCallCount()).toBe(1);
		});
	});

	describe("manual check bookkeeping", () => {
		it("keeps the manual window id when a background poll runs", async () => {
			const controller = initAutoUpdater({
				fetchPolicyManifest: () => Promise.resolve(null),
			});

			await controller.checkForUpdates(7);
			// The 15-minute poll must not steal the pending answer from window 7.
			await controller.checkForUpdates();

			updater.listeners.get("update-available")?.({
				version: "9.9.9",
				releaseNotes: "notes",
			});
			await flush();

			expect(renderers.sent).toEqual([
				{
					channel: PlatformChannels.UpdateCheckResult,
					payload: {
						status: "available",
						version: "9.9.9",
						manualWebContentsId: 7,
					},
				},
			]);

			controller.dispose();
		});

		it("stays silent for a background result when no window asked", async () => {
			const controller = initAutoUpdater({
				fetchPolicyManifest: () => Promise.resolve(null),
			});

			await controller.checkForUpdates();
			updater.listeners.get("update-available")?.({ version: "9.9.9" });
			await flush();

			expect(renderers.sent).toHaveLength(0);

			controller.dispose();
		});
	});

	describe("forced-release policy", () => {
		it("does not retract when the policy manifest is unreachable", async () => {
			const onForcedRelease = vi.fn();
			const onUpdateNotAvailable = vi.fn();
			const controller = initAutoUpdater({
				fetchPolicyManifest: () => Promise.resolve(null),
				onForcedRelease,
				onUpdateNotAvailable,
			});

			updater.listeners.get("update-available")?.({ version: "9.9.9" });
			await flush();

			// A network blip must neither block a UI nor unlock one the operator asked to block.
			expect(onForcedRelease).not.toHaveBeenCalled();
			expect(onUpdateNotAvailable).not.toHaveBeenCalled();

			controller.dispose();
		});

		it("announces the version the manifest marks as forced", async () => {
			const onForcedRelease = vi.fn();
			const controller = initAutoUpdater({
				fetchPolicyManifest: () =>
					Promise.resolve({
						version: "9.9.9",
						path: "Planstar-9.9.9-arm64-mac.zip",
						is_forced: true,
						releaseNotes: "policy notes",
					}),
				onForcedRelease,
			});

			updater.listeners.get("update-available")?.({ version: "9.9.9" });
			await flush();

			expect(onForcedRelease).toHaveBeenCalledWith({
				version: "9.9.9",
				releaseNotes: "policy notes",
			});

			controller.dispose();
		});

		it("retracts when the policy no longer forces the version", async () => {
			const onUpdateNotAvailable = vi.fn();
			const controller = initAutoUpdater({
				fetchPolicyManifest: () =>
					Promise.resolve({
						version: "9.9.9",
						path: "Planstar-9.9.9-arm64-mac.zip",
						is_forced: false,
					}),
				onUpdateNotAvailable,
			});

			// `update-not-available` never fires while a newer version exists, so this branch is the
			// only route by which a withdrawn flag reaches the guard.
			updater.listeners.get("update-available")?.({ version: "9.9.9" });
			await flush();

			expect(onUpdateNotAvailable).toHaveBeenCalledTimes(1);

			controller.dispose();
		});

		it("retracts when the manifest forces a different version", async () => {
			const onForcedRelease = vi.fn();
			const onUpdateNotAvailable = vi.fn();
			const controller = initAutoUpdater({
				fetchPolicyManifest: () =>
					Promise.resolve({
						version: "10.0.0",
						path: "Planstar-10.0.0-arm64-mac.zip",
						is_forced: true,
					}),
				onForcedRelease,
				onUpdateNotAvailable,
			});

			updater.listeners.get("update-available")?.({ version: "9.9.9" });
			await flush();

			expect(onForcedRelease).not.toHaveBeenCalled();
			expect(onUpdateNotAvailable).toHaveBeenCalledTimes(1);

			controller.dispose();
		});

		it("retracts on update-not-available", async () => {
			const onUpdateNotAvailable = vi.fn();
			const controller = initAutoUpdater({
				fetchPolicyManifest: () => Promise.resolve(null),
				onUpdateNotAvailable,
			});

			updater.listeners.get("update-not-available")?.({ version: "0.0.0" });

			expect(onUpdateNotAvailable).toHaveBeenCalledTimes(1);

			controller.dispose();
		});
	});
});
