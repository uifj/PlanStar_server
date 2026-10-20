import { DEFAULT_LOCALE, type Locale } from "@harness/desktop-shared";

/**
 * Menu label IDs. Every entry in the application menu references one of these; the actual
 * localized string comes from `getDesktopMenuMessage(locale, id)`.
 *
 * Adding a menu item means: add an ID here, add both locales to `MESSAGES`, then reference the ID
 * in `menu.ts`. Nothing else changes.
 */
export const desktopMenuMessageIds = {
	appAbout: "app.about",
	appServices: "app.services",
	appHide: "app.hide",
	appHideOthers: "app.hideOthers",
	appShowAll: "app.unhide",
	appQuit: "app.quit",

	file: "file",
	fileCloseWindow: "file.closeWindow",

	edit: "edit",
	editUndo: "edit.undo",
	editRedo: "edit.redo",
	editCut: "edit.cut",
	editCopy: "edit.copy",
	editPaste: "edit.paste",
	editSelectAll: "edit.selectAll",

	view: "view",
	viewReload: "view.reload",
	viewForceReload: "view.forceReload",
	viewToggleDevTools: "view.toggleDevTools",
	viewResetZoom: "view.resetZoom",
	viewZoomIn: "view.zoomIn",
	viewZoomOut: "view.zoomOut",
	viewToggleFullScreen: "view.toggleFullScreen",

	window: "window",
	windowMinimize: "window.minimize",
	windowZoom: "window.zoom",

	help: "help",
	helpCheckForUpdates: "help.checkForUpdates",
	helpDownloadUpdate: "help.downloadUpdate",
	helpCancelUpdateDownload: "help.cancelUpdateDownload",
	helpQuitAndInstallUpdate: "help.quitAndInstallUpdate",
	helpExportLogs: "help.exportLogs",
	helpOpenFeedback: "help.openFeedback",
} as const;

export type DesktopMenuMessageId =
	(typeof desktopMenuMessageIds)[keyof typeof desktopMenuMessageIds];

type MessageTable = Record<DesktopMenuMessageId, string>;

const EN_US: MessageTable = {
	[desktopMenuMessageIds.appAbout]: "About {appName}",
	[desktopMenuMessageIds.appServices]: "Services",
	[desktopMenuMessageIds.appHide]: "Hide {appName}",
	[desktopMenuMessageIds.appHideOthers]: "Hide Others",
	[desktopMenuMessageIds.appShowAll]: "Show All",
	[desktopMenuMessageIds.appQuit]: "Quit {appName}",

	[desktopMenuMessageIds.file]: "File",
	[desktopMenuMessageIds.fileCloseWindow]: "Close Window",

	[desktopMenuMessageIds.edit]: "Edit",
	[desktopMenuMessageIds.editUndo]: "Undo",
	[desktopMenuMessageIds.editRedo]: "Redo",
	[desktopMenuMessageIds.editCut]: "Cut",
	[desktopMenuMessageIds.editCopy]: "Copy",
	[desktopMenuMessageIds.editPaste]: "Paste",
	[desktopMenuMessageIds.editSelectAll]: "Select All",

	[desktopMenuMessageIds.view]: "View",
	[desktopMenuMessageIds.viewReload]: "Reload",
	[desktopMenuMessageIds.viewForceReload]: "Force Reload",
	[desktopMenuMessageIds.viewToggleDevTools]: "Toggle Developer Tools",
	[desktopMenuMessageIds.viewResetZoom]: "Actual Size",
	[desktopMenuMessageIds.viewZoomIn]: "Zoom In",
	[desktopMenuMessageIds.viewZoomOut]: "Zoom Out",
	[desktopMenuMessageIds.viewToggleFullScreen]: "Toggle Full Screen",

	[desktopMenuMessageIds.window]: "Window",
	[desktopMenuMessageIds.windowMinimize]: "Minimize",
	[desktopMenuMessageIds.windowZoom]: "Zoom",

	[desktopMenuMessageIds.help]: "Help",
	[desktopMenuMessageIds.helpCheckForUpdates]: "Check for Updates…",
	[desktopMenuMessageIds.helpDownloadUpdate]: "Download Update",
	[desktopMenuMessageIds.helpCancelUpdateDownload]: "Cancel Download",
	[desktopMenuMessageIds.helpQuitAndInstallUpdate]: "Restart to Update",
	[desktopMenuMessageIds.helpExportLogs]: "Export Logs…",
	[desktopMenuMessageIds.helpOpenFeedback]: "Send Feedback…",
};

const ZH_CN: MessageTable = {
	[desktopMenuMessageIds.appAbout]: "关于 {appName}",
	[desktopMenuMessageIds.appServices]: "服务",
	[desktopMenuMessageIds.appHide]: "隐藏 {appName}",
	[desktopMenuMessageIds.appHideOthers]: "隐藏其他",
	[desktopMenuMessageIds.appShowAll]: "全部显示",
	[desktopMenuMessageIds.appQuit]: "退出 {appName}",

	[desktopMenuMessageIds.file]: "文件",
	[desktopMenuMessageIds.fileCloseWindow]: "关闭窗口",

	[desktopMenuMessageIds.edit]: "编辑",
	[desktopMenuMessageIds.editUndo]: "撤销",
	[desktopMenuMessageIds.editRedo]: "重做",
	[desktopMenuMessageIds.editCut]: "剪切",
	[desktopMenuMessageIds.editCopy]: "复制",
	[desktopMenuMessageIds.editPaste]: "粘贴",
	[desktopMenuMessageIds.editSelectAll]: "全选",

	[desktopMenuMessageIds.view]: "视图",
	[desktopMenuMessageIds.viewReload]: "重新加载",
	[desktopMenuMessageIds.viewForceReload]: "强制重新加载",
	[desktopMenuMessageIds.viewToggleDevTools]: "切换开发者工具",
	[desktopMenuMessageIds.viewResetZoom]: "实际大小",
	[desktopMenuMessageIds.viewZoomIn]: "放大",
	[desktopMenuMessageIds.viewZoomOut]: "缩小",
	[desktopMenuMessageIds.viewToggleFullScreen]: "切换全屏",

	[desktopMenuMessageIds.window]: "窗口",
	[desktopMenuMessageIds.windowMinimize]: "最小化",
	[desktopMenuMessageIds.windowZoom]: "缩放",

	[desktopMenuMessageIds.help]: "帮助",
	[desktopMenuMessageIds.helpCheckForUpdates]: "检查更新…",
	[desktopMenuMessageIds.helpDownloadUpdate]: "下载更新",
	[desktopMenuMessageIds.helpCancelUpdateDownload]: "取消下载",
	[desktopMenuMessageIds.helpQuitAndInstallUpdate]: "重启以更新",
	[desktopMenuMessageIds.helpExportLogs]: "导出日志…",
	[desktopMenuMessageIds.helpOpenFeedback]: "发送反馈…",
};

const MESSAGES: Record<Locale, MessageTable> = {
	"en-US": EN_US,
	"zh-CN": ZH_CN,
};

export function getDesktopMenuMessage(
	locale: Locale,
	id: DesktopMenuMessageId,
): string {
	const table = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
	return table[id];
}

/** Substitute `{appName}` placeholders so callers do not have to string-replace themselves. */
export function formatDesktopMenuMessage(
	locale: Locale,
	id: DesktopMenuMessageId,
	vars: { appName?: string } = {},
): string {
	const template = getDesktopMenuMessage(locale, id);
	return template.replace(/\{appName\}/g, vars.appName ?? "");
}
