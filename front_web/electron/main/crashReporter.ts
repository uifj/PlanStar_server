import { app, crashReporter } from "electron";

import { logger } from "./logger";

/**
 * Crash capture.
 *
 * Starts Electron's built-in `crashReporter` (minidump upload) and wires the process-level guards
 * that ZCode's `desktopCrashCapture.ts` + `appCrashCaptureBootstrap.ts` provide:
 *   - `render-process-gone` / `child-process-gone` → log + optional Sentry breadcrumb
 *   - `uncaughtException` / `unhandledRejection`   → log, report, but **do not exit**
 *
 * The "do not exit" rule matters: a stray rejection in a background timer must not take the whole
 * shell down. ZCode's `hostUncaughtExceptionGuard.ts` makes the same call.
 *
 * Upload URL defaults to the harness server's `/api/desktop/crash-report` endpoint; when the
 * endpoint is absent the reporter silently drops uploads (Electron logs a 404 and moves on).
 */

export interface CrashReporterOptions {
	/** Override the submit URL; defaults to `<HARNESS_API_URL>/api/desktop/crash-report`. */
	submitURL?: string;
	/** Extra annotations attached to every dump (device id, release channel, …). */
	extra?: Record<string, string>;
}

function defaultSubmitURL(): string {
	const base = (process.env.HARNESS_API_URL ?? "http://localhost:8000").replace(
		/\/+$/,
		"",
	);
	return `${base}/api/desktop/crash-report`;
}

export function initCrashReporter(options: CrashReporterOptions = {}): void {
	const submitURL = options.submitURL ?? defaultSubmitURL();

	try {
		crashReporter.start({
			submitURL,
			uploadToServer: true,
			compress: true,
			ignoreSystemCrashHandler: false,
			extra: {
				product: app.name,
				version: app.getVersion(),
				platform: process.platform,
				arch: process.arch,
				...options.extra,
			},
		});
		logger.info("[crash-reporter] started, submitURL =", submitURL);
	} catch (error) {
		// A misconfigured submitURL must not prevent boot; the shell keeps running without uploads.
		logger.warn("[crash-reporter] failed to start:", error);
		return;
	}

	app.on("render-process-gone", (_event, webContents, details) => {
		logger.error("[crash-reporter] renderer gone:", {
			reason: details.reason,
			exitCode: details.exitCode,
			webContentsId: webContents.id,
		});
	});

	app.on("child-process-gone", (_event, details) => {
		logger.error("[crash-reporter] child process gone:", {
			type: details.type,
			reason: details.reason,
			exitCode: details.exitCode,
		});
	});

	process.on("uncaughtException", (error) => {
		logger.error("[crash-reporter] uncaughtException:", error);
		// Deliberately no `app.quit()`: a background timer throwing must not kill the shell.
	});

	process.on("unhandledRejection", (reason) => {
		logger.error("[crash-reporter] unhandledRejection:", reason);
	});
}

export const __test__ = { defaultSubmitURL };
