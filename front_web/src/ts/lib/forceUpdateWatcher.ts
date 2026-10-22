/**
 * The force-update wiring `app.tsx` runs at boot, kept out of the entry point so the retraction
 * path is testable without booting the whole SPA.
 *
 * Order matters: subscribe to the push channels *first*, then ask for the current state. A window
 * that was rebuilt (or reloaded) missed the earlier broadcast, and a retraction that lands between
 * the two calls must still close the modal rather than being swallowed.
 */

import type { DesktopBridgeApi, ForceUpdateRequiredPayload } from "@harness/desktop-shared";

export type ForceUpdateSource = Pick<
	DesktopBridgeApi,
	"onForceUpdateRequired" | "onForceUpdateCleared" | "getForceUpdateState"
>;

export type ForceUpdateHandlers = {
	open: (payload: ForceUpdateRequiredPayload) => void;
	close: () => void;
	/** False once the bridge generation changed (a new preload took over); stale answers are dropped. */
	isCurrent?: () => boolean;
};

export function watchForceUpdate(
	source: ForceUpdateSource,
	{ open, close, isCurrent = () => true }: ForceUpdateHandlers,
): () => void {
	const unsubs = [
		source.onForceUpdateRequired((payload) => open(payload)),
		source.onForceUpdateCleared(() => close()),
	];

	void source
		.getForceUpdateState()
		.then((payload) => {
			if (isCurrent() && payload) {
				open(payload);
			}
		})
		.catch(() => undefined);

	return () => {
		for (const unsubscribe of unsubs) {
			unsubscribe();
		}
	};
}
