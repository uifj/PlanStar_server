import fs from "node:fs";
import path from "node:path";
import {
	DEFAULT_LOCALE,
	type DesktopCapabilities,
	type Locale,
	type LogPayload,
	normalizeLocale,
	PlatformChannels,
} from "@harness/desktop-shared";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import {
	type AutoUpdaterController,
	initAutoUpdater,
} from "./main/autoUpdater";
import {
	createExecuteDesktopCommand,
	type ExecuteDesktopCommand,
} from "./main/commandHandlers";
import { initCrashReporter } from "./main/crashReporter";
import {
	createDeepLinkSingleInstanceData,
	createPendingRoute,
	extractDeepLinkUrlFromArgs,
	extractDeepLinkUrlFromSingleInstanceData,
	routeFromArgv,
	routeFromUrl,
} from "./main/deepLink";
import {
	DESKTOP_ORIGIN,
	DESKTOP_PORT,
	healthUrl,
	PROTOCOL_SCHEME,
	rendererRoot,
} from "./main/desktop";
import { exportLogs } from "./main/exportLogs";
// Subsystems (Stage 0-6). Every import is unconditional; the feature flags decide whether the
// subsystem is *wired*, not whether the module loads.
import { featureFlags } from "./main/featureFlags";
import { type FeedbackController, initFeedback } from "./main/feedback";
import {
	type ForceUpdateGuardController,
	initForceUpdateGuard,
} from "./main/forceUpdateGuard";
import {
	bindFileLogger,
	flushLogsSync,
	getLogDir,
	initLogger,
	logger,
} from "./main/logger";
import { initLogUploader, type LogUploader } from "./main/logUploader";
import {
	type ApplicationMenuController,
	initApplicationMenu,
	resolveSystemApplicationLocale,
} from "./main/menu";
import { runSmoke } from "./main/smoke";
import { isTrustedNavigation, isTrustedSenderUrl } from "./main/trustedUrl";
import { waitingHtml } from "./main/waitingPage";
import {
	createWindowStateTracker,
	readWindowState,
	type WindowStateTracker,
} from "./main/windowState";
import { createRendererServer, listen } from "./server";

const PRELOAD = path.join(__dirname, "preload.cjs");

// Auto-update needs a packaged build: electron-updater refuses to start unpackaged because there is
// no `app-update.yml` next to the binary. The flag alone is not the whole answer, so boot, the
// command bus and the capability snapshot all read this one constant instead of re-deriving it.
const autoUpdateActive = featureFlags.autoUpdate && app.isPackaged;

// A route handed to the shell before the renderer can accept it would be dropped by the history
// API, so it is parked in a single slot until the renderer reports ready (or the app page loads).
const pendingRoute = createPendingRoute();
let mainWindow: BrowserWindow | null = null;
let menuController: ApplicationMenuController | null = null;
/** The locale the shell reports to the renderer. Owned here, not by the menu: the menu can be
 *  switched off by a feature flag and the locale query must still answer. */
let applicationLocale: Locale = DEFAULT_LOCALE;
let feedbackController: FeedbackController | null = null;
let autoUpdaterController: AutoUpdaterController | null = null;
let forceUpdateGuard: ForceUpdateGuardController | null = null;
let logUploader: LogUploader | null = null;
let executeDesktopCommand: ExecuteDesktopCommand | null = null;
let windowStateTracker: WindowStateTracker | null = null;

const sendRoute = (win: BrowserWindow, route: string): void => {
	if (win.isDestroyed()) {
		return;
	}
	// Loading the waiting page (`data:`) also settles `did-finish-load`; delivering there would
	// make the preload call `history.pushState` on a document that has no such origin.
	if (
		win.webContents.isLoading() ||
		!isTrustedNavigation(win.webContents.getURL())
	) {
		pendingRoute.set(route);
		return;
	}
	win.webContents.send(PlatformChannels.DesktopRoute, route);
};

/** Hand over the parked route once the app document (not the waiting page) is in place. */
const deliverPendingRoute = (win: BrowserWindow): void => {
	const route = pendingRoute.take();
	if (route) {
		sendRoute(win, route);
	}
};

const healthy = async (): Promise<boolean> => {
	try {
		const response = await fetch(healthUrl(), {
			signal: AbortSignal.timeout(2000),
		});
		return response.ok;
	} catch {
		return false;
	}
};

const createWindow = (): BrowserWindow => {
	const state = readWindowState();
	const tracker = createWindowStateTracker(state);
	windowStateTracker = tracker;

	const win = new BrowserWindow({
		x: state.x,
		y: state.y,
		width: state.width,
		height: state.height,
		minWidth: 900,
		minHeight: 600,
		show: false,
		title: "Anytype Harness",
		backgroundColor: "#ffffff",
		// macOS hides the native titlebar and overlays the traffic lights on the sidebar's own head
		// row, the way anytype does: {12,19} lands them inside that 36px row, so the window has no
		// titlebar band above the app (see src/styles/legacy.css). Other platforms keep inset.
		...(process.platform === "darwin"
			? {
					titleBarStyle: "hidden" as const,
					trafficLightPosition: { x: 12, y: 19 },
				}
			: { titleBarStyle: "hiddenInset" as const }),
		webPreferences: {
			preload: PRELOAD,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			spellcheck: true,
		},
	});

	tracker.attach(win);

	win.once("ready-to-show", () => {
		win.show();
		if (state.maximized) {
			win.maximize();
		}
	});

	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//.test(url) && !isTrustedNavigation(url)) {
			shell.openExternal(url).catch(() => undefined);
		}
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (event, url) => {
		if (!isTrustedNavigation(url)) {
			event.preventDefault();
		}
	});

	win.webContents.on("did-finish-load", () => {
		// The waiting page also settles this event; only the app document may receive a route.
		if (!isTrustedSenderUrl(win.webContents.getURL())) {
			return;
		}
		deliverPendingRoute(win);
	});

	return win;
};

const loadApp = async (win: BrowserWindow): Promise<void> => {
	if (await healthy()) {
		await win.loadURL(DESKTOP_ORIGIN);
		return;
	}
	await win.loadURL(
		"data:text/html;charset=utf-8," + encodeURIComponent(waitingHtml()),
	);

	const timer = setInterval(async () => {
		if (win.isDestroyed()) {
			clearInterval(timer);
			return;
		}
		if (await healthy()) {
			clearInterval(timer);
			await win.loadURL(DESKTOP_ORIGIN);
		}
	}, 2000);
};

const openRoute = (route: string | null): void => {
	if (!route) {
		return;
	}
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.focus();
		sendRoute(mainWindow, route);
		return;
	}
	pendingRoute.set(route);
};

const dialogError = async (message: string): Promise<void> => {
	const { dialog } = await import("electron");
	await dialog.showErrorBox("Anytype Harness", message);
};

function wireCommandBus(): ExecuteDesktopCommand {
	return createExecuteDesktopCommand({
		openFeedbackDialog: featureFlags.feedback
			? () => feedbackController?.openFeedbackDialog()
			: undefined,
		captureScreenshot: featureFlags.feedback
			? (win) =>
					feedbackController?.captureScreenshot(win) ?? {
						png: "",
						width: 0,
						height: 0,
						unsupported: true,
					}
			: undefined,
		exportLogs: featureFlags.exportLogs
			? () => {
					// Captured locally: the module-level binding is cleared on quit, and the closure runs later.
					const uplink = logUploader;
					return exportLogs({
						// The archive is the deliverable; pushing the same records to the backend is what makes
						// `uploaded` in the result truthful.
						uploadUplink: uplink ? () => uplink.flush() : undefined,
					});
				}
			: undefined,
		checkForUpdates: autoUpdateActive
			? (id) => autoUpdaterController?.checkForUpdates(id)
			: undefined,
		downloadUpdate: autoUpdateActive
			? () => autoUpdaterController?.downloadUpdate()
			: undefined,
		cancelUpdateDownload: autoUpdateActive
			? () => autoUpdaterController?.cancelDownload()
			: undefined,
		quitAndInstallUpdate: autoUpdateActive
			? () => autoUpdaterController?.quitAndInstall()
			: undefined,
		setApplicationLocale: (locale) => menuController?.setLocale(locale),
	});
}

/**
 * IPC trust boundary: every handler must answer only the shell's own renderer frame. For `on`
 * channels a silent drop is correct; for `handle` the rejection reaches the renderer facade, which
 * already degrades to `null`.
 */
function isTrustedEvent(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
	return isTrustedSenderUrl(event.senderFrame?.url);
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
	if (!isTrustedEvent(event)) {
		throw new Error("untrusted sender");
	}
}

function wireIpc(): void {
	ipcMain.on(PlatformChannels.Log, (event, payload: LogPayload) => {
		if (!isTrustedEvent(event)) {
			return;
		}
		if (!payload || typeof payload !== "object") {
			return;
		}
		const level = normalizeLogLevel(payload.level);
		logger.fromRenderer(
			level,
			Array.isArray(payload.args) ? payload.args : [payload.args],
		);
	});

	ipcMain.handle(
		PlatformChannels.ExecuteDesktopCommand,
		(event, command: unknown, payload: unknown) => {
			assertTrustedSender(event);
			const win = BrowserWindow.fromWebContents(event.sender);
			if (!executeDesktopCommand) {
				return { ok: false, reason: "command-bus-not-ready" };
			}
			return executeDesktopCommand(command as never, win, payload);
		},
	);

	ipcMain.handle(PlatformChannels.GetSystemLocale, (event) => {
		assertTrustedSender(event);
		return applicationLocale;
	});

	ipcMain.handle(PlatformChannels.GetDesktopZoomLevel, (event) => {
		assertTrustedSender(event);
		const win = BrowserWindow.fromWebContents(event.sender);
		return { zoomLevel: win?.webContents.getZoomLevel() ?? 0 };
	});

	// Capability snapshot (B1): the renderer queries this once at boot so UI can hide entries for
	// subsystems that are flagged off, instead of calling a method and inferring "disabled" from a
	// failure. Every field must describe what the running shell can actually do — `tray` and
	// `notifications` are contract placeholders that report false until they are implemented.
	ipcMain.handle(
		PlatformChannels.GetCapabilities,
		(event): DesktopCapabilities => {
			assertTrustedSender(event);
			return {
				isDesktop: true,
				feedback: featureFlags.feedback,
				exportLogs: featureFlags.exportLogs,
				notifications: false,
				tray: false,
				autoUpdate: autoUpdateActive,
				crashReporter: featureFlags.crashReporter,
				// Forced updates are detected by the updater's manifest check, so the guard is only
				// meaningful when auto-update is actually live (packaged build + flag).
				forceUpdate: featureFlags.forceUpdate && autoUpdateActive,
				// Mirrors the gate in `boot`: an unpackaged run has no userData contract and no release
				// feed, so the uplink is not running either.
				logUpload: featureFlags.logUpload && app.isPackaged,
			};
		},
	);

	ipcMain.on(
		PlatformChannels.SetApplicationLocale,
		(event, locale: unknown) => {
			if (!isTrustedEvent(event)) {
				return;
			}
			const next = normalizeLocale(locale);
			applicationLocale = next;
			menuController?.setLocale(next);
			for (const win of BrowserWindow.getAllWindows()) {
				if (!win.isDestroyed()) {
					win.webContents.send(PlatformChannels.ApplicationLocaleChanged, next);
				}
			}
		},
	);

	ipcMain.on(PlatformChannels.RendererReady, (event) => {
		if (!isTrustedEvent(event)) {
			return;
		}
		const win = BrowserWindow.fromWebContents(event.sender);
		if (win) {
			deliverPendingRoute(win);
		}
	});
}

function normalizeLogLevel(
	value: unknown,
): "debug" | "info" | "warn" | "error" {
	return value === "debug" || value === "warn" || value === "error"
		? value
		: "info";
}

const boot = async (): Promise<void> => {
	// Stage 1: logger. Must run before anything else logs.
	if (featureFlags.logger) {
		const logDir =
			process.env.HARNESS_E2E_LOG_DIR ??
			path.join(app.getPath("userData"), "logs");
		initLogger({ logDir });
		bindFileLogger();
		// `initLogger` already prunes expired files; deleting again here was a duplicate scan.
		logger.info("[boot] logger initialised at", getLogDir());
	}

	// Stage 7: log uplink. Started right after the logger so the boot sequence itself is mirrored,
	// and only in a packaged build: a dev run would spam the production API with HMR noise.
	if (featureFlags.logUpload && app.isPackaged) {
		logUploader = initLogUploader();
		logger.info("[boot] log uplink enabled");
	}

	// Stage 6: crash reporter (flag-gated, default off).
	if (featureFlags.crashReporter) {
		initCrashReporter();
	}

	if (!app.setAsDefaultProtocolClient(PROTOCOL_SCHEME)) {
		logger.warn(`[boot] could not register the ${PROTOCOL_SCHEME}:// handler`);
	}

	const root = rendererRoot(app.isPackaged);
	if (!fs.existsSync(path.join(root, "index.html"))) {
		const message = `The renderer is missing at ${root}. Build it first:\n  pnpm run build:desktop`;
		await dialogError(message);
		app.quit();
		return;
	}

	try {
		await listen(createRendererServer(root), DESKTOP_PORT);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		await dialogError(
			code === "EADDRINUSE"
				? `Port ${DESKTOP_PORT} is busy, and the desktop origin http://localhost:${DESKTOP_PORT} is fixed — the backend only trusts that one. Free the port, or start the shell with HARNESS_DESKTOP_PORT and add the matching origin to the server's TRUSTED_ORIGINS.`
				: `The desktop shell could not start its local server: ${String(error)}`,
		);
		app.quit();
		return;
	}

	// Stage 2: command bus + menu. The menu is the only owner of accelerators, so switching it off
	// also removes every keyboard shortcut — that is the flag's documented meaning.
	executeDesktopCommand = wireCommandBus();
	wireIpc();

	applicationLocale = resolveSystemApplicationLocale();
	if (featureFlags.menu) {
		menuController = initApplicationMenu({
			executeDesktopCommand,
			initialLocale: applicationLocale,
			capabilities: {
				autoUpdate: autoUpdateActive,
				feedback: featureFlags.feedback,
				exportLogs: featureFlags.exportLogs,
				devTools: !app.isPackaged,
			},
		});
	}

	// Stage 3: feedback (flag-gated, default on).
	if (featureFlags.feedback) {
		feedbackController = initFeedback();
	}

	// Stage 5: force-update guard. Must be installed before the updater: the updater reports "this
	// release is mandatory" through it. Gated on `autoUpdateActive` as well, because a shell that
	// cannot check for updates can never learn a release is forced.
	if (featureFlags.forceUpdate && autoUpdateActive) {
		forceUpdateGuard = initForceUpdateGuard();
	}

	// Stage 6: auto-update (flag-gated, default off; packaged builds only — in a dev run there is
	// no app-update.yml and electron-updater refuses to start).
	if (autoUpdateActive) {
		autoUpdaterController = initAutoUpdater({
			onForcedRelease: (payload) => forceUpdateGuard?.announce(payload),
			onUpdateNotAvailable: () => forceUpdateGuard?.clear(),
		});
		autoUpdaterController.startPolling();
	}

	mainWindow = createWindow();
	await loadApp(mainWindow);

	// Deep link: prefer additionalData (macOS protocol handler) over argv.
	const additionalData = (
		app as unknown as { getAdditionalData?: () => unknown }
	).getAdditionalData?.();
	const deepLinkUrl =
		extractDeepLinkUrlFromSingleInstanceData(additionalData) ??
		extractDeepLinkUrlFromArgs(process.argv);
	openRoute(routeFromUrl(deepLinkUrl) ?? routeFromArgv(process.argv));

	if (process.env.HARNESS_DESKTOP_SMOKE) {
		const ok = await runSmoke(mainWindow);
		app.exit(ok ? 0 : 1);
	}
};

// Single-instance lock with deep-link additionalData so macOS protocol launches reach the
// already-running instance even when argv contains only the app path.
const singleInstanceData = createDeepLinkSingleInstanceData(process.argv);
if (!app.requestSingleInstanceLock(singleInstanceData)) {
	app.quit();
} else {
	app.on(
		"second-instance",
		(_event, argv, _workingDirectory, additionalData) => {
			const url =
				extractDeepLinkUrlFromSingleInstanceData(additionalData) ??
				extractDeepLinkUrlFromArgs(argv);
			openRoute(routeFromUrl(url) ?? routeFromArgv(argv));
		},
	);

	app.on("open-url", (event, url) => {
		event.preventDefault();
		openRoute(routeFromUrl(url));
	});

	app.on("web-contents-created", (_event, contents) => {
		contents.on("will-navigate", (e, url) => {
			if (!isTrustedNavigation(url)) {
				e.preventDefault();
			}
		});
	});

	app
		.whenReady()
		.then(boot)
		.catch(async (error) => {
			await dialogError(String(error));
			app.quit();
		});

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			const win = createWindow();
			void loadApp(win);
		}
	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") {
			app.quit();
		}
	});

	app.on("before-quit", () => {
		autoUpdaterController?.stopPolling();
		autoUpdaterController?.dispose();
		forceUpdateGuard?.dispose();
		feedbackController?.dispose();
		// Anything still queued is spooled synchronously, so a quit does not drop the tail of the log.
		void logUploader?.dispose();
		logUploader = null;
		// The frame is only readable while the window exists, and the log tail only survives if it
		// reaches disk before the process exits.
		if (mainWindow && !mainWindow.isDestroyed()) {
			windowStateTracker?.flush(mainWindow);
		}
		flushLogsSync();
	});
}
