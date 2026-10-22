import { PlatformChannels } from "@harness/desktop-shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The guard is the shell's half of the forced-update contract. Three behaviours are load-bearing and
 * cannot be observed from the renderer alone:
 *   1. `announce` is idempotent per version, so the 15-minute poll cannot stack modals;
 *   2. `clear` pushes `ForceUpdateCleared`, which is the only way an already-open modal learns the
 *      server retracted the flag (replay-latest skips `null`, so a null broadcast would be lost);
 *   3. `GetForceUpdateState` answers a freshly recreated window, and its lifetime is the guard's.
 */

type Listener = (...args: unknown[]) => unknown;

const ipc = vi.hoisted(() => {
	const handlers = new Map<string, Listener>();
	const removed: string[] = [];
	return {
		handlers,
		removed,
		handle: (channel: string, listener: Listener) => {
			handlers.set(channel, listener);
		},
		removeHandler: (channel: string) => {
			removed.push(channel);
			handlers.delete(channel);
		},
	};
});

const windows = vi.hoisted(() => {
	const created: {
		destroyed: boolean;
		sent: { channel: string; payload: unknown }[];
	}[] = [];
	return {
		created,
		getAllWindows: () =>
			created.map((entry) => ({
				isDestroyed: () => entry.destroyed,
				webContents: {
					send: (channel: string, payload: unknown) => {
						entry.sent.push({ channel, payload });
					},
				},
			})),
	};
});

vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows: windows.getAllWindows },
	ipcMain: { handle: ipc.handle, removeHandler: ipc.removeHandler },
}));

import { initForceUpdateGuard } from "../forceUpdateGuard";

/** A live window whose outbound IPC traffic the test can inspect. */
function addWindow(): {
	destroyed: boolean;
	sent: { channel: string; payload: unknown }[];
} {
	const entry = { destroyed: false, sent: [] };
	windows.created.push(entry);
	return entry;
}

const TRUSTED_URL = "http://localhost:8321/index.html";

/** Invoke the registered `GetForceUpdateState` handler the way the renderer would. */
function invokeGetForceUpdateState(url: string | undefined): unknown {
	const handler = ipc.handlers.get(PlatformChannels.GetForceUpdateState);
	expect(handler).toBeTypeOf("function");
	return handler?.({ senderFrame: url === undefined ? null : { url } });
}

describe("forceUpdateGuard", () => {
	beforeEach(() => {
		ipc.handlers.clear();
		ipc.removed.length = 0;
		windows.created.length = 0;
	});

	it("broadcasts ForceUpdateRequired and remembers the current state", () => {
		const guard = initForceUpdateGuard();
		const win = addWindow();

		guard.announce({ version: "1.2.3", releaseNotes: "fixes" });

		expect(win.sent).toEqual([
			{
				channel: PlatformChannels.ForceUpdateRequired,
				payload: { version: "1.2.3", releaseNotes: "fixes" },
			},
		]);
		expect(guard.getCurrent()).toEqual({
			version: "1.2.3",
			releaseNotes: "fixes",
		});

		guard.dispose();
	});

	it("dedupes a repeated announce for the same version", () => {
		const guard = initForceUpdateGuard();
		const win = addWindow();

		guard.announce({ version: "1.2.3" });
		guard.announce({ version: "1.2.3" });
		guard.announce({ version: "1.2.3" });

		// One broadcast, three polls: the poll must not re-open a modal the user already read.
		expect(win.sent).toHaveLength(1);

		guard.dispose();
	});

	it("broadcasts again when a newer forced version supersedes the current one", () => {
		const guard = initForceUpdateGuard();
		const win = addWindow();

		guard.announce({ version: "1.2.3" });
		guard.announce({ version: "1.2.4" });

		expect(win.sent.map((entry) => entry.payload)).toEqual([
			{ version: "1.2.3" },
			{ version: "1.2.4" },
		]);
		expect(guard.getCurrent()).toEqual({ version: "1.2.4" });

		guard.dispose();
	});

	it("clear pushes ForceUpdateCleared and resets the current state", () => {
		const guard = initForceUpdateGuard();
		const win = addWindow();

		guard.announce({ version: "1.2.3" });
		guard.clear();

		expect(win.sent[1]).toEqual({
			channel: PlatformChannels.ForceUpdateCleared,
			payload: { version: "1.2.3" },
		});
		expect(guard.getCurrent()).toBeNull();

		guard.dispose();
	});

	it("clear without a pending force is a silent no-op", () => {
		const guard = initForceUpdateGuard();
		const win = addWindow();

		guard.clear();

		expect(win.sent).toHaveLength(0);
		expect(guard.getCurrent()).toBeNull();

		guard.dispose();
	});

	it("skips destroyed windows instead of throwing", () => {
		const guard = initForceUpdateGuard();
		const dead = addWindow();
		dead.destroyed = true;
		const live = addWindow();

		guard.announce({ version: "1.2.3" });

		expect(dead.sent).toHaveLength(0);
		expect(live.sent).toHaveLength(1);

		guard.dispose();
	});

	it("answers GetForceUpdateState for a recreated window", () => {
		const guard = initForceUpdateGuard();

		expect(invokeGetForceUpdateState(TRUSTED_URL)).toBeNull();

		guard.announce({ version: "1.2.3" });
		expect(invokeGetForceUpdateState(TRUSTED_URL)).toEqual({
			version: "1.2.3",
		});

		guard.clear();
		expect(invokeGetForceUpdateState(TRUSTED_URL)).toBeNull();

		guard.dispose();
	});

	it("rejects GetForceUpdateState from an untrusted sender", () => {
		const guard = initForceUpdateGuard();

		expect(() =>
			invokeGetForceUpdateState(
				"http://localhost:8321@evil.example/index.html",
			),
		).toThrow(/untrusted sender/);
		expect(() => invokeGetForceUpdateState(undefined)).toThrow(
			/untrusted sender/,
		);

		guard.dispose();
	});

	it("dispose removes the IPC handler exactly once", () => {
		const guard = initForceUpdateGuard();

		guard.dispose();
		guard.dispose();

		expect(ipc.handlers.has(PlatformChannels.GetForceUpdateState)).toBe(false);
		expect(ipc.removed).toEqual([PlatformChannels.GetForceUpdateState]);
	});
});
