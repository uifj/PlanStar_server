import * as fs from "node:fs";
import * as path from "node:path";
import {
	type CaptureWindowScreenshotResult,
	PlatformChannels,
	type SubmitFeedbackPayload,
	type SubmitFeedbackResult,
} from "@harness/desktop-shared";
import { app, BrowserWindow, ipcMain } from "electron";
import { logger } from "./logger";

/**
 * Feedback plumbing: window screenshot + "open the feedback dialog" push + submission sink.
 *
 * The dialog UI itself lives in the renderer; the shell's job is only to
 *   (a) broadcast `OpenFeedbackDialog` when the menu item is chosen, so any renderer that has
 *       subscribed can react,
 *   (b) answer the command bus' `capture-screenshot` with a base64 PNG of the sender window, and
 *   (c) persist `SubmitFeedback` payloads under `userData/feedback/<timestamp>/` and best-effort
 *       forward the metadata to the harness backend's `POST /api/desktop/feedback` intake (B4).
 *       Local persistence is the source of truth: it keeps the loop closed and auditable even when
 *       no backend is reachable, the export-logs flow can pick the directory up later, and nothing
 *       is silently dropped. The server copy centralizes reports when the API is available.
 *
 * Screenshot capture deliberately uses `webContents.capturePage()` rather than `desktopCapturer`:
 * the latter prompts for screen-recording permission on macOS 10.15+, which is a hostile surprise
 * for a bug-report flow.
 */

export interface FeedbackController {
	openFeedbackDialog(): Promise<void>;
	captureScreenshot(win: BrowserWindow): Promise<CaptureWindowScreenshotResult>;
	dispose(): void;
}

/** Harness API origin; the desktop intake endpoints live under `/api/desktop`. */
const apiBase = (
	process.env.HARNESS_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

/**
 * Best-effort server intake (B4). Posts the non-screenshot metadata to the backend so reports are
 * centralized when a server is reachable. Never throws: the local copy persisted by `submitFeedback`
 * is the source of truth, so an offline/missing backend only downgrades to "local only".
 */
async function forwardFeedbackToServer(
	meta: Record<string, unknown>,
): Promise<boolean> {
	try {
		const response = await fetch(`${apiBase}/api/desktop/feedback`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(meta),
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) {
			logger.warn(`[feedback] server intake returned ${response.status}`);
			return false;
		}
		return true;
	} catch (error) {
		logger.warn(
			"[feedback] server intake unavailable, kept local copy only:",
			error,
		);
		return false;
	}
}

export function initFeedback(): FeedbackController {
	const openFeedbackDialog = async (): Promise<void> => {
		const windows = BrowserWindow.getAllWindows();
		if (windows.length === 0) {
			logger.warn("[feedback] open-feedback requested but no windows exist");
			return;
		}
		for (const win of windows) {
			if (!win.isDestroyed()) {
				win.webContents.send(PlatformChannels.OpenFeedbackDialog);
			}
		}
	};

	const captureScreenshot = async (
		win: BrowserWindow,
	): Promise<CaptureWindowScreenshotResult> => {
		if (win.isDestroyed()) {
			return { png: "", width: 0, height: 0, unsupported: true };
		}
		try {
			const image = await win.webContents.capturePage();
			const size = image.getSize();
			if (size.width === 0 || size.height === 0) {
				// An occluded or minimized window can return an empty image on some platforms.
				return { png: "", width: 0, height: 0, unsupported: true };
			}
			return {
				png: image.toPNG().toString("base64"),
				width: size.width,
				height: size.height,
			};
		} catch (error) {
			logger.error("[feedback] capturePage failed:", error);
			return { png: "", width: 0, height: 0, unsupported: true };
		}
	};

	const submitFeedback = async (
		payload: unknown,
	): Promise<SubmitFeedbackResult> => {
		const text =
			payload &&
			typeof payload === "object" &&
			typeof (payload as SubmitFeedbackPayload).text === "string"
				? (payload as SubmitFeedbackPayload).text.trim()
				: "";
		if (!text) {
			return { success: false, error: "feedback text is required" };
		}
		try {
			const stamp = new Date().toISOString().replace(/[:.]/g, "-");
			const dir = path.join(app.getPath("userData"), "feedback", stamp);
			fs.mkdirSync(dir, { recursive: true });

			const body = payload as SubmitFeedbackPayload;
			const { png, ...meta } = body;
			fs.writeFileSync(
				path.join(dir, "feedback.json"),
				JSON.stringify(
					{
						...meta,
						text,
						appVersion: body.appVersion || app.getVersion(),
						platform: process.platform,
						submittedAt: new Date().toISOString(),
						hasScreenshot: Boolean(png),
					},
					null,
					2,
				),
				"utf8",
			);
			if (png) {
				fs.writeFileSync(
					path.join(dir, "screenshot.png"),
					Buffer.from(png, "base64"),
				);
			}

			// B4: forward the metadata (not the screenshot, which stays local) to the backend intake.
			// Awaited so the log reflects the outcome, but a failure never changes the success result.
			const forwarded = await forwardFeedbackToServer({
				text,
				email: body.email,
				appVersion: body.appVersion || app.getVersion(),
				platform: process.platform,
				locale: body.locale,
				submittedAt: new Date().toISOString(),
			});
			logger.info(
				`[feedback] saved report to ${dir} (server intake: ${forwarded ? "ok" : "local-only"})`,
			);
			return { success: true, path: dir };
		} catch (error) {
			logger.error("[feedback] submit failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	};

	const submitHandler = (
		_event: Electron.IpcMainInvokeEvent,
		payload: unknown,
	) => submitFeedback(payload);

	ipcMain.handle(PlatformChannels.SubmitFeedback, submitHandler);

	return {
		openFeedbackDialog,
		captureScreenshot,
		dispose() {
			ipcMain.removeHandler(PlatformChannels.SubmitFeedback);
		},
	};
}
