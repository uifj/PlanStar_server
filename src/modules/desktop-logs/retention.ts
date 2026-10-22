import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { sweepExpired } from "./service.js";

/**
 * Log retention loop.
 *
 * Runs once at boot (so a restart after a long outage cleans up immediately) then every 6 hours.
 * A timer rather than cron: the deployment target is a single container with no scheduler, and the
 * sweep is idempotent, so overlapping restarts are harmless.
 */

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

/** Sweep once, logging rather than throwing: retention must never block startup. */
export function sweepNow(now = new Date()): Promise<void> {
	return sweepExpired(now)
		.then((result) => {
			if (result.failedFiles.length > 0) {
				logger.warn(
					{ failed: result.failedFiles.length },
					"desktop log retention could not delete some files",
				);
			}
		})
		.catch((error: unknown) => {
			logger.warn({ err: error }, "desktop log retention sweep failed");
		});
}

export function startLogRetention(): void {
	if (timer) {
		return;
	}
	void sweepNow();
	timer = setInterval(() => {
		void sweepNow();
	}, SWEEP_INTERVAL_MS);
	// Never hold the process open just to keep the sweep alive.
	timer.unref();
	logger.info(
		{ retentionDays: env.DESKTOP_LOG_RETENTION_DAYS },
		"desktop log retention started",
	);
}

export function stopLogRetention(): void {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
}

/** Test hook: the sweep interval, so a test does not have to hardcode it. */
export const __test__ = { SWEEP_INTERVAL_MS };
