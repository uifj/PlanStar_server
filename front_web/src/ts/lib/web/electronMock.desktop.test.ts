// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { desktop } from "../desktop";
import electronMock from "./electronMock";

/**
 * Integration coverage for the C1 single-bridge wiring: in the browser build `entry.web.tsx` calls
 * `electronMock.installDesktopFacade()`, which mounts the same `window.Desktop` surface the Electron
 * preload provides. These tests exercise the facade THROUGH that mock to prove the renderer's
 * `Lib/desktop` path is live in web mode (it used to be dead — `window.Desktop` was never set), while
 * `isShell()` still reports false so shell-only UI stays hidden.
 */

const realBridgeMarker = { isDesktop: true, marker: "real-preload-bridge" };

beforeEach(() => {
	localStorage.clear();
	delete (window as any).Desktop;
});

describe("electronMock desktop facade — web mode single bridge", () => {
	it("mounts window.Desktop with isDesktop false, so isShell() stays false", () => {
		electronMock.installDesktopFacade();

		expect((window as any).Desktop).toBeTruthy();
		expect((window as any).Desktop.isDesktop).toBe(false);
		expect(desktop.isShell()).toBe(false);
	});

	it("routes submitFeedback through the facade to the localStorage queue (was dead before C1)", async () => {
		electronMock.installDesktopFacade();

		const result = await desktop.submitFeedback({
			text: "hello from web",
		} as any);

		expect(result).toEqual({ success: true, path: "web-localStorage" });
		const queue = JSON.parse(
			localStorage.getItem("anytype_feedbackQueue") || "[]",
		);
		expect(queue).toHaveLength(1);
		expect(queue[0].text).toBe("hello from web");
	});

	it("reports exportLogs as unavailable in web mode instead of resolving null", async () => {
		electronMock.installDesktopFacade();

		expect(await desktop.exportLogs()).toEqual({
			success: false,
			error: "web-mode",
		});
	});

	it("forwards executeCommand and validates the payload", async () => {
		electronMock.installDesktopFacade();

		const result = (await desktop.executeCommand(
			"open-external" as any,
			"ftp://bad",
		)) as any;
		expect(result).toEqual({ ok: false, reason: "invalid-url" });
	});

	it("adapts the web command-bus {ok:false} (downloadUpdate) to null via the facade", async () => {
		electronMock.installDesktopFacade();

		expect(await desktop.downloadUpdate()).toBeNull();
	});

	it("returns a callable unsubscribe from a web subscription", () => {
		electronMock.installDesktopFacade();

		const off = desktop.onUpdateStateChanged(() => {});
		expect(typeof off).toBe("function");
		expect(() => off()).not.toThrow();
	});

	it("exposes a web capability snapshot (B1): feedback on, every shell-only subsystem off", async () => {
		electronMock.installDesktopFacade();

		const caps = await desktop.capabilities();
		expect(caps).toEqual({
			isDesktop: false,
			feedback: true,
			exportLogs: false,
			notifications: false,
			tray: false,
			autoUpdate: false,
			crashReporter: false,
			forceUpdate: false,
		});
	});
});

describe("electronMock desktop facade — shell guard", () => {
	it("never shadows a real preload bridge already on window.Desktop", () => {
		(window as any).Desktop = realBridgeMarker;

		electronMock.installDesktopFacade();

		expect((window as any).Desktop).toBe(realBridgeMarker);
		expect(desktop.isShell()).toBe(true);
	});
});
