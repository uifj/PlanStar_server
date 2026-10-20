import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridgeApi } from "./desktop";
import { DesktopCommandIds, desktop } from "./desktop";

/**
 * The facade must (a) degrade to silent no-ops in pure-web mode, (b) forward verbatim when the
 * bridge is present, and (c) turn bridge rejections into `null` so UI code never needs try/catch.
 */

function stubWindow(withBridge: Partial<DesktopBridgeApi> | null) {
	vi.stubGlobal(
		"window",
		withBridge ? { Desktop: { isDesktop: true, ...withBridge } } : {},
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("desktop facade — web mode (no window.Desktop)", () => {
	it("reports isShell false and never throws on notifyRendererReady", () => {
		stubWindow(null);
		expect(desktop.isShell()).toBe(false);
		expect(() => desktop.notifyRendererReady()).not.toThrow();
	});

	it("resolves shell calls to null", async () => {
		stubWindow(null);
		expect(await desktop.exportLogs()).toBeNull();
		expect(await desktop.getUpdateState()).toBeNull();
		expect(await desktop.submitFeedback({ text: "x" })).toBeNull();
		expect(
			await desktop.executeCommand(DesktopCommandIds.ExportLogs),
		).toBeNull();
	});

	it("returns a callable no-op unsubscribe", () => {
		stubWindow(null);
		const off = desktop.onUpdateStateChanged(() => {});
		expect(typeof off).toBe("function");
		expect(() => off()).not.toThrow();
	});
});

describe("desktop facade — shell mode", () => {
	it("forwards executeCommand with the shared command id", async () => {
		const executeCommand = vi.fn().mockResolvedValue("ok");
		stubWindow({ executeCommand } as Partial<DesktopBridgeApi>);

		expect(desktop.isShell()).toBe(true);
		await desktop.checkForUpdates();

		expect(executeCommand).toHaveBeenCalledWith(
			DesktopCommandIds.CheckForUpdates,
			undefined,
		);
	});

	it("routes exportLogs through the command bus and passes the result through", async () => {
		const result = { success: true, path: "/tmp/logs.zip" };
		const executeCommand = vi.fn().mockResolvedValue(result);
		stubWindow({ executeCommand } as Partial<DesktopBridgeApi>);

		expect(await desktop.exportLogs()).toEqual(result);
		expect(executeCommand).toHaveBeenCalledWith(
			DesktopCommandIds.ExportLogs,
			undefined,
		);
	});

	it("degrades a rejected command-bus call to null", async () => {
		stubWindow({
			executeCommand: vi.fn().mockRejectedValue(new Error("no handler")),
		} as Partial<DesktopBridgeApi>);

		expect(await desktop.exportLogs()).toBeNull();
	});

	it("adapts command-bus {ok:true} to void and {ok:false} to null for update actions", async () => {
		const executeCommand = vi.fn().mockResolvedValue({ ok: true });
		stubWindow({ executeCommand } as Partial<DesktopBridgeApi>);

		expect(await desktop.downloadUpdate()).toBeUndefined();
		expect(executeCommand).toHaveBeenCalledWith(
			DesktopCommandIds.DownloadUpdate,
			undefined,
		);

		executeCommand.mockResolvedValue({
			ok: false,
			reason: "auto-update-disabled",
		});
		expect(await desktop.downloadUpdate()).toBeNull();
	});

	it("attaches subscriptions and returns the bridge unsubscribe", () => {
		const off = vi.fn();
		const onUpdateStateChanged = vi.fn().mockReturnValue(off);
		stubWindow({ onUpdateStateChanged } as Partial<DesktopBridgeApi>);

		const cb = () => {};
		const unsubscribe = desktop.onUpdateStateChanged(cb);

		expect(onUpdateStateChanged).toHaveBeenCalledTimes(1);
		unsubscribe();
		expect(off).toHaveBeenCalledTimes(1);
	});

	it("routes notifyRendererReady to the bridge", () => {
		const notifyRendererReady = vi.fn();
		stubWindow({ notifyRendererReady } as Partial<DesktopBridgeApi>);

		desktop.notifyRendererReady();
		expect(notifyRendererReady).toHaveBeenCalledTimes(1);
	});
});
