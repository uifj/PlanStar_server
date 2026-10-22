import {
	type DesktopCommandId,
	DesktopCommandIds,
	type Locale,
} from "@harness/desktop-shared";
import {
	app,
	BrowserWindow,
	Menu,
	type MenuItemConstructorOptions,
} from "electron";
import type { ExecuteDesktopCommand } from "./commandHandlers";
import { logger } from "./logger";
import { desktopMenuMessageIds, getDesktopMenuMessage } from "./menuMessages";

/**
 * The application menu.
 *
 * Every clickable item is a command ID dispatched through the shared bus (`commandHandlers.ts`),
 * not an inline `BrowserWindow.*` call. That way a keyboard shortcut, a renderer button and a
 * menu entry all execute the same handler with the same telemetry, and locale changes only need
 * to rebuild the template — the wiring is untouched.
 *
 * Feature-flagged entries (auto-update, feedback, export-logs) are hidden entirely when their
 * subsystem is not installed, so a deployment that turns a flag off does not show a dead menu item.
 */

export interface MenuCapabilities {
	autoUpdate: boolean;
	feedback: boolean;
	exportLogs: boolean;
	/** Dev-only entries (Force Reload, Toggle DevTools) — hidden in packaged builds by default. */
	devTools: boolean;
}

export interface BuildMenuOptions {
	locale: Locale;
	appName: string;
	capabilities: MenuCapabilities;
	executeDesktopCommand: ExecuteDesktopCommand;
	/** Suppress accelerators while a shortcut-recording UI is focused; menu items stay clickable. */
	disableShortcutAccelerators?: boolean;
}

function accelerator(
	options: BuildMenuOptions,
	fallback: string,
): string | undefined {
	return options.disableShortcutAccelerators ? undefined : fallback;
}

function dispatch(
	options: BuildMenuOptions,
	command: DesktopCommandId,
): () => void {
	return () => {
		const win = BrowserWindow.getFocusedWindow();
		void options.executeDesktopCommand(command, win).catch((error) => {
			logger.error("[menu] command failed:", command, error);
		});
	};
}

export function buildApplicationMenuTemplate(
	options: BuildMenuOptions,
): MenuItemConstructorOptions[] {
	const { locale, appName, capabilities } = options;
	const label = (id: keyof typeof desktopMenuMessageIds): string =>
		getDesktopMenuMessage(locale, desktopMenuMessageIds[id]);
	const appLabel = (id: keyof typeof desktopMenuMessageIds): string =>
		label(id).replaceAll("{appName}", appName);

	const template: MenuItemConstructorOptions[] = [];

	if (process.platform === "darwin") {
		template.push({
			label: appName,
			submenu: [
				{
					id: "app.about",
					label: appLabel("appAbout"),
					click: dispatch(options, DesktopCommandIds.ShowAbout),
				},
				{ type: "separator" },
				{ label: appLabel("appServices"), role: "services" },
				{ type: "separator" },
				{ label: appLabel("appHide"), role: "hide" },
				{ label: label("appHideOthers"), role: "hideOthers" },
				{ label: label("appShowAll"), role: "unhide" },
				{ type: "separator" },
				{ label: appLabel("appQuit"), role: "quit" },
			],
		});
	}

	template.push({
		label: label("file"),
		submenu: [
			{
				id: "file.close",
				label: label("fileCloseWindow"),
				accelerator: accelerator(options, "CmdOrCtrl+W"),
				click: dispatch(options, DesktopCommandIds.Close),
			},
			...(process.platform === "darwin"
				? ([] as MenuItemConstructorOptions[])
				: [
						{ type: "separator" as const },
						{ label: appLabel("appQuit"), role: "quit" as const },
					]),
		],
	});

	template.push({
		label: label("edit"),
		submenu: [
			{ label: label("editUndo"), role: "undo" },
			{ label: label("editRedo"), role: "redo" },
			{ type: "separator" },
			{ label: label("editCut"), role: "cut" },
			{ label: label("editCopy"), role: "copy" },
			{ label: label("editPaste"), role: "paste" },
			{ type: "separator" },
			{ label: label("editSelectAll"), role: "selectAll" },
		],
	});

	const viewSubmenu: MenuItemConstructorOptions[] = [
		{
			id: "view.reload",
			label: label("viewReload"),
			accelerator: accelerator(options, "CmdOrCtrl+R"),
			click: dispatch(options, DesktopCommandIds.Reload),
		},
	];

	if (capabilities.devTools) {
		viewSubmenu.push({
			id: "view.forceReload",
			label: label("viewForceReload"),
			accelerator: accelerator(options, "CmdOrCtrl+Shift+R"),
			click: dispatch(options, DesktopCommandIds.ForceReload),
		});
		viewSubmenu.push({
			id: "view.toggleDevTools",
			label: label("viewToggleDevTools"),
			accelerator: accelerator(
				options,
				process.platform === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I",
			),
			click: dispatch(options, DesktopCommandIds.ToggleDevTools),
		});
	}

	viewSubmenu.push({ type: "separator" });
	viewSubmenu.push({
		id: "view.resetZoom",
		label: label("viewResetZoom"),
		accelerator: accelerator(options, "CmdOrCtrl+0"),
		click: dispatch(options, DesktopCommandIds.ResetZoom),
	});
	viewSubmenu.push({
		id: "view.zoomIn",
		label: label("viewZoomIn"),
		accelerator: accelerator(options, "CmdOrCtrl+Plus"),
		click: dispatch(options, DesktopCommandIds.ZoomIn),
	});
	viewSubmenu.push({
		id: "view.zoomOut",
		label: label("viewZoomOut"),
		accelerator: accelerator(options, "CmdOrCtrl+-"),
		click: dispatch(options, DesktopCommandIds.ZoomOut),
	});
	viewSubmenu.push({ type: "separator" });
	viewSubmenu.push({
		id: "view.toggleFullScreen",
		label: label("viewToggleFullScreen"),
		accelerator: accelerator(
			options,
			process.platform === "darwin" ? "Ctrl+Command+F" : "F11",
		),
		click: dispatch(options, DesktopCommandIds.ToggleFullScreen),
	});

	template.push({ label: label("view"), submenu: viewSubmenu });

	template.push({
		label: label("window"),
		submenu: [
			{ label: label("windowMinimize"), role: "minimize" },
			{ label: label("windowZoom"), role: "zoom" },
			...(process.platform === "darwin"
				? ([
						{ type: "separator" as const },
						{ role: "front" as const },
					] satisfies MenuItemConstructorOptions[])
				: []),
		],
	});

	const helpSubmenu: MenuItemConstructorOptions[] = [];

	if (capabilities.autoUpdate) {
		helpSubmenu.push({
			id: "help.checkForUpdates",
			label: label("helpCheckForUpdates"),
			click: dispatch(options, DesktopCommandIds.CheckForUpdates),
		});
		helpSubmenu.push({
			id: "help.downloadUpdate",
			label: label("helpDownloadUpdate"),
			click: dispatch(options, DesktopCommandIds.DownloadUpdate),
		});
		helpSubmenu.push({
			id: "help.cancelUpdateDownload",
			label: label("helpCancelUpdateDownload"),
			click: dispatch(options, DesktopCommandIds.CancelUpdateDownload),
		});
		helpSubmenu.push({
			id: "help.quitAndInstallUpdate",
			label: label("helpQuitAndInstallUpdate"),
			click: dispatch(options, DesktopCommandIds.QuitAndInstallUpdate),
		});
		helpSubmenu.push({ type: "separator" });
	}

	if (capabilities.exportLogs) {
		helpSubmenu.push({
			id: "help.exportLogs",
			label: label("helpExportLogs"),
			click: dispatch(options, DesktopCommandIds.ExportLogs),
		});
	}

	if (capabilities.feedback) {
		helpSubmenu.push({
			id: "help.openFeedback",
			label: label("helpOpenFeedback"),
			click: dispatch(options, DesktopCommandIds.OpenFeedback),
		});
	}

	if (helpSubmenu.length > 0) {
		template.push({
			label: label("help"),
			role: process.platform === "darwin" ? "help" : undefined,
			submenu: helpSubmenu,
		});
	}

	return template;
}

export interface MenuState {
	locale: Locale;
	capabilities: MenuCapabilities;
}

export interface ApplicationMenuController {
	setLocale(locale: Locale): void;
}

export function initApplicationMenu(options: {
	executeDesktopCommand: ExecuteDesktopCommand;
	initialLocale: Locale;
	capabilities: MenuCapabilities;
}): ApplicationMenuController {
	let state: MenuState = {
		locale: options.initialLocale,
		capabilities: { ...options.capabilities },
	};

	const rebuild = (): void => {
		const template = buildApplicationMenuTemplate({
			locale: state.locale,
			appName: app.name,
			capabilities: state.capabilities,
			executeDesktopCommand: options.executeDesktopCommand,
		});
		try {
			Menu.setApplicationMenu(Menu.buildFromTemplate(template));
		} catch (error) {
			// A malformed template must not kill the shell; keep the previous menu if any.
			logger.error("[menu] failed to install template:", error);
		}
	};

	rebuild();

	return {
		setLocale(locale) {
			if (state.locale === locale) {
				return;
			}
			state = { ...state, locale };
			rebuild();
		},
	};
}

/**
 * Resolve the initial locale from the OS. macOS `app.getLocale()` can return `en-US` even when
 * the system is Chinese, so we prefer the first entry of `getPreferredSystemLanguages()` — same
 * approach ZCode uses in `resolveSystemApplicationLocale()`.
 */
export function resolveSystemApplicationLocale(): Locale {
	try {
		const preferred = app.getPreferredSystemLanguages?.()[0] ?? app.getLocale();
		return preferred.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
	} catch {
		return "en-US";
	}
}
