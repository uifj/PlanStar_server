import type {
	ForceUpdateClearedPayload,
	ForceUpdateRequiredPayload,
} from "@harness/desktop-shared";
import { describe, expect, it, vi } from "vitest";
import { watchForceUpdate } from "./forceUpdateWatcher";

/**
 * The retraction path is the reason this wiring exists: before it, a forced release that the server
 * withdrew left the blocking modal on screen until the app was restarted.
 */

type Required = (payload: ForceUpdateRequiredPayload) => void;
type Cleared = (payload: ForceUpdateClearedPayload) => void;

const payload: ForceUpdateRequiredPayload = {
	version: "0.58.0",
	releaseNotes: "forced",
};

function harness(state: ForceUpdateRequiredPayload | null) {
	const required = new Set<Required>();
	const cleared = new Set<Cleared>();
	const open = vi.fn();
	const close = vi.fn();
	const order: string[] = [];
	return {
		open,
		close,
		order,
		source: {
			onForceUpdateRequired: (callback: Required) => {
				order.push("subscribe:required");
				required.add(callback);
				return () => required.delete(callback);
			},
			onForceUpdateCleared: (callback: Cleared) => {
				order.push("subscribe:cleared");
				cleared.add(callback);
				return () => cleared.delete(callback);
			},
			getForceUpdateState: vi.fn(async () => {
				order.push("query");
				return state;
			}),
		},
		emitRequired: (next: ForceUpdateRequiredPayload) => {
			for (const callback of [...required]) callback(next);
		},
		emitCleared: () => {
			for (const callback of [...cleared]) callback({ version: payload.version });
		},
		listenerCount: () => required.size + cleared.size,
	};
}

describe("watchForceUpdate", () => {
	it("subscribes before asking for the current state", async () => {
		const h = harness(null);
		watchForceUpdate(h.source, { open: h.open, close: h.close });
		await Promise.resolve();
		expect(h.order).toEqual(["subscribe:required", "subscribe:cleared", "query"]);
	});

	it("opens a blocking modal from the query when a rebuild missed the push", async () => {
		const h = harness(payload);
		watchForceUpdate(h.source, { open: h.open, close: h.close });
		await vi.waitFor(() => expect(h.open).toHaveBeenCalledWith(payload));
		expect(h.close).not.toHaveBeenCalled();
	});

	it("does not open anything when the current state is null", async () => {
		const h = harness(null);
		watchForceUpdate(h.source, { open: h.open, close: h.close });
		await vi.waitFor(() => expect(h.source.getForceUpdateState).toHaveBeenCalled());
		await Promise.resolve();
		expect(h.open).not.toHaveBeenCalled();
	});

	it("closes on retraction and reopens when the release is forced again", async () => {
		const h = harness(null);
		watchForceUpdate(h.source, { open: h.open, close: h.close });
		await Promise.resolve();

		h.emitRequired(payload);
		expect(h.open).toHaveBeenLastCalledWith(payload);

		h.emitCleared();
		expect(h.close).toHaveBeenCalledTimes(1);

		h.emitRequired({ version: "0.59.0" });
		expect(h.open).toHaveBeenLastCalledWith({ version: "0.59.0" });
		expect(h.open).toHaveBeenCalledTimes(2);
	});

	it("drops a state answer that arrives after the bridge generation changed", async () => {
		const h = harness(payload);
		watchForceUpdate(h.source, {
			open: h.open,
			close: h.close,
			isCurrent: () => false,
		});
		await vi.waitFor(() => expect(h.source.getForceUpdateState).toHaveBeenCalled());
		await Promise.resolve();
		expect(h.open).not.toHaveBeenCalled();
	});

	it("stops listening to both channels once disposed", async () => {
		const h = harness(null);
		const dispose = watchForceUpdate(h.source, { open: h.open, close: h.close });
		await Promise.resolve();
		dispose();

		h.emitRequired(payload);
		h.emitCleared();
		expect(h.open).not.toHaveBeenCalled();
		expect(h.close).not.toHaveBeenCalled();
		expect(h.listenerCount()).toBe(0);
	});
});
