import fs from "node:fs";
import path from "node:path";
import {
	type DesktopCapabilities,
	type Locale,
	type LogPayload,
	normalizeLocale,
	PlatformChannels,
} from "@harness/desktop-shared";
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
	extractDeepLinkUrlFromArgs,
	extractDeepLinkUrlFromSingleInstanceData,
	routeFromArgv,
	routeFromUrl,
} from "./main/deepLink";
import {
	apiUrl,
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
import { bindFileLogger, getLogDir, initLogger, logger } from "./main/logger";
import { cleanupExpiredLogFiles } from "./main/logRetention";
import {
	type ApplicationMenuController,
	initApplicationMenu,
	resolveSystemApplicationLocale,
} from "./main/menu";
import { runSmoke } from "./main/smoke";
import { waitingHtml } from "./main/waitingPage";
import { createWindowStateTracker, readWindowState } from "./main/windowState";
import { createRendererServer, listen } from "./server";

const PRELOAD = path.join(__dirname, "preload.cjs");

// A route handed to the shell before the document is ready would be dropped by the history API,
// so it is parked until the first load settles.
const pendingRoutes: string[] = [];
let mainWindow: BrowserWindow | null = null;
let menuController: ApplicationMenuController | null = null;
let feedbackController: FeedbackController | null = null;
let autoUpdaterController: AutoUpdaterController | null = null;
let forceUpdateGuard: ForceUpdateGuardController | null = null;
let executeDesktopCommand: ExecuteDesktopCommand | null = null;

const sendRoute = (win: BrowserWindow, route: string): void => {
	const deliver = (): void => {
		if (!win.isDestroyed()) {
			win.webContents.send(PlatformChannels.DesktopRoute, route);
		}
	};
	if (win.webContents.isLoading()) {
		win.webContents.once("did-finish-load", deliver);
		return;
	}
	deliver();
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
		// macOS hides the native titlebar and parks the traffic lights inside the renderer's
		// 48px drag band (scss/desktop/titlebar.scss), ZCode-style; other platforms keep inset.
		...(process.platform === "darwin"
			? {
					titleBarStyle: "hidden" as const,
					trafficLightPosition: { x: 20, y: 17 },
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
		if (/^https?:\/\//.test(url) && !url.startsWith(DESKTOP_ORIGIN)) {
			shell.openExternal(url).catch(() => undefined);
		}
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (event, url) => {
		if (!url.startsWith(DESKTOP_ORIGIN) && !url.startsWith("data:")) {
			event.preventDefault();
		}
	});

	win.webContents.on("did-finish-load", () => {
		while (pendingRoutes.length) {
			const route = pendingRoutes.shift();
			if (route) {
				sendRoute(win, route);
			}
		}
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
	pendingRoutes.push(route);
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
		exportLogs: featureFlags.exportLogs ? () => exportLogs() : undefined,
		checkForUpdates: featureFlags.autoUpdate
			? (id) => autoUpdaterController?.checkForUpdates(id)
			: undefined,
		downloadUpdate: featureFlags.autoUpdate
			? () => autoUpdaterController?.downloadUpdate()
			: undefined,
		cancelUpdateDownload: featureFlags.autoUpdate
			? () => autoUpdaterController?.cancelDownload()
			: undefined,
		quitAndInstallUpdate: featureFlags.autoUpdate
			? () => autoUpdaterController?.quitAndInstall()
			: undefined,
		setApplicationLocale: (locale) => menuController?.setLocale(locale),
	});
}

function wireIpc(): void {
	ipcMain.on(PlatformChannels.Log, (_event, payload: LogPayload) => {
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
			const win = BrowserWindow.fromWebContents(event.sender);
			if (!executeDesktopCommand) {
				return { ok: false, reason: "command-bus-not-ready" };
			}
			return executeDesktopCommand(command as never, win, payload);
		},
	);

	ipcMain.handle(
		PlatformChannels.GetSystemLocale,
		() => menuController?.getLocale() ?? "en-US",
	);

	ipcMain.handle(PlatformChannels.GetDesktopZoomLevel, (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		return { zoomLevel: win?.webContents.getZoomLevel() ?? 0 };
	});

	// Capability snapshot (B1): the renderer queries this once at boot so UI can hide entries for
	// subsystems that are flagged off, instead of calling a method and inferring "disabled" from a
	// failure. Mirrors the resolved feature flags; `isDesktop` is always true here (this is the shell).
	ipcMain.handle(
		PlatformChannels.GetCapabilities,
		(): DesktopCapabilities => ({
			isDesktop: true,
			feedback: featureFlags.feedback,
			exportLogs: featureFlags.exportLogs,
			notifications: featureFlags.notifications,
			tray: featureFlags.tray,
			autoUpdate: featureFlags.autoUpdate,
			crashReporter: featureFlags.crashReporter,
			forceUpdate: featureFlags.forceUpdate,
		}),
	);

	ipcMain.on(
		PlatformChannels.SetApplicationLocale,
		(_event, locale: unknown) => {
			const next = normalizeLocale(locale);
			menuController?.setLocale(next);
			for (const win of BrowserWindow.getAllWindows()) {
				if (!win.isDestroyed()) {
					win.webContents.send(PlatformChannels.ApplicationLocaleChanged, next);
				}
			}
		},
	);

	ipcMain.on(PlatformChannels.RendererReady, () => {
		// Reserved for future telemetry; currently a no-op acknowledgement.
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
		cleanupExpiredLogFiles(logDir);
		logger.info("[boot] logger initialised at", getLogDir());
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

	// Stage 2: command bus + menu.
	executeDesktopCommand = wireCommandBus();
	wireIpc();

	const initialLocale: Locale = resolveSystemApplicationLocale();
	menuController = initApplicationMenu({
		executeDesktopCommand,
		initialLocale,
		capabilities: {
			autoUpdate: featureFlags.autoUpdate,
			feedback: featureFlags.feedback,
			exportLogs: featureFlags.exportLogs,
			devTools: !app.isPackaged,
		},
	});

	// Stage 3: feedback (flag-gated, default on).
	if (featureFlags.feedback) {
		feedbackController = initFeedback();
	}

	// Stage 5: auto-update (flag-gated, default off).
	if (featureFlags.autoUpdate && app.isPackaged) {
		autoUpdaterController = initAutoUpdater();
		autoUpdaterController.startPolling();
	}

	// Stage 6: force-update guard (flag-gated, default off).
	if (featureFlags.forceUpdate) {
		forceUpdateGuard = initForceUpdateGuard();
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
			if (!url.startsWith(DESKTOP_ORIGIN) && !url.startsWith("data:")) {
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
		feedbackController?.dispose();
		forceUpdateGuard?.dispose();
	});
}
