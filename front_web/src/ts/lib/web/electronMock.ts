/**
 * Web-compatible mock of the Electron API for browser mode.
 * This enables running Anytype in a standard web browser without Electron.
 */

import { serverAddress } from "./serverAddress";

/**
 * Upload a file to the dev server and get a real filesystem path.
 * The dev server writes the file to a temp directory that the backend can access.
 */
async function uploadFileToServer(file: File): Promise<string> {
	// Read file as base64
	const base64 = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			// Remove data URL prefix to get just the base64
			const base64 = result.split(",")[1] || result;
			resolve(base64);
		};
		reader.onerror = () => reject(new Error("Failed to read file"));
		reader.readAsDataURL(file);
	});

	// Upload to dev server
	const response = await fetch("/api/web-upload", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			filename: file.name,
			content: base64,
		}),
	});

	if (!response.ok) {
		throw new Error(`Upload failed: ${response.statusText}`);
	}

	const result = await response.json();
	console.log("[Web] Uploaded:", file.name, "->", result.path);
	return result.path;
}

interface MockTab {
	id: string;
	data: any;
	token?: string;
}

interface MockConfig {
	theme: string;
	zoom: number;
	interfaceLang: string;
	channel?: string;
	languages: string[];
	hideTray: boolean;
	showMenuBar: boolean;
	flagsMw: {
		time: boolean;
		json: boolean;
		request: boolean;
		event: boolean;
		sync: boolean;
		file: boolean;
		subscribe: boolean;
	};
}

class WebStorage {
	private prefix = "anytype_";

	get(key: string): any {
		try {
			const value = localStorage.getItem(this.prefix + key);
			return value ? JSON.parse(value) : undefined;
		} catch {
			return undefined;
		}
	}

	set(key: string, value: any): void {
		try {
			localStorage.setItem(this.prefix + key, JSON.stringify(value));
		} catch (e) {
			console.warn("[WebStorage] Failed to set:", key, e);
		}
	}

	delete(key: string): void {
		localStorage.removeItem(this.prefix + key);
	}
}

type ApiHandler = (args: any[]) => any | Promise<any>;

type EventCallback = (...args: any[]) => void;

class ElectronMock {
	private storage = new WebStorage();
	private eventListeners: Map<string, Set<EventCallback>> = new Map();
	private tabId_ = "web-" + Math.random().toString(36).substring(7);
	private tabs: MockTab[] = [{ id: this.tabId_, data: {} }];
	private config: MockConfig;
	private windowId = 1;
	private apiHandlers: Map<string, ApiHandler>;

	constructor() {
		this.config = this.storage.get("config") || this.getDefaultConfig();
		this.apiHandlers = this.initApiHandlers();
	}

	private getDefaultConfig(): MockConfig {
		return {
			theme: "",
			zoom: 0,
			interfaceLang: "en-US",
			languages: [],
			hideTray: false,
			showMenuBar: true,
			flagsMw: {
				time: false,
				json: false,
				request: false,
				event: false,
				sync: false,
				file: false,
				subscribe: false,
			},
		};
	}

	private initApiHandlers(): Map<string, ApiHandler> {
		const handlers = new Map<string, ApiHandler>();

		// Init & config handlers
		handlers.set("getInitData", () => ({
			id: this.windowId,
			dataPath: this.userPath(),
			config: this.config,
			isDark:
				this.config.theme === "dark" ||
				(this.config.theme === "" &&
					window.matchMedia("(prefers-color-scheme: dark)").matches),
			isChild: false,
			route: "",
			isPinChecked: true,
			languages: navigator.languages,
			css: "",
			activeIndex: 0,
			isSingleTab: true,
			activeTabId: this.tabId_,
		}));

		handlers.set("setConfig", (args) => {
			Object.assign(this.config, args[0]);
			this.storage.set("config", this.config);
			return true;
		});

		handlers.set("setTheme", (args) => {
			this.config.theme = args[0];
			this.storage.set("config", this.config);
			U.Dom.removeClass(
				document.body as HTMLElement,
				"themeDark",
				"themeLight",
			);
			if (args[0] === "dark") {
				U.Dom.addClass(document.body as HTMLElement, "themeDark");
			} else if (args[0] === "light") {
				U.Dom.addClass(document.body as HTMLElement, "themeLight");
			}
			return true;
		});

		handlers.set("setZoom", (args) => {
			this.config.zoom = args[0];
			this.storage.set("config", this.config);
			return true;
		});

		// URL & path handlers
		handlers.set("openUrl", (args) => {
			window.open(args[0], "_blank");
			return true;
		});

		handlers.set("openPath", (args) => {
			console.log("[Web] openPath not supported:", args[0]);
			return true;
		});

		// Keytar handlers (credential storage)
		handlers.set(
			"keytarGet",
			(args) => this.storage.get("keytar_" + args[0]) || null,
		);
		handlers.set("keytarSet", (args) => {
			this.storage.set("keytar_" + args[0], args[1]);
			return true;
		});
		handlers.set("keytarDelete", (args) => {
			this.storage.delete("keytar_" + args[0]);
			return true;
		});

		// Tab handlers
		handlers.set("getTabs", () => ({
			tabs: this.tabs.map((t) => ({ id: t.id, data: t.data })),
			id: this.tabId_,
			isVisible: false,
		}));

		handlers.set("getTab", (args) => {
			const tab = this.tabs.find((t) => t.id === args[0]);
			return tab ? { id: tab.id, data: tab.data, token: tab.token } : null;
		});

		handlers.set("updateTab", (args) => {
			const tabToUpdate = this.tabs.find((t) => t.id === args[0]);
			if (tabToUpdate) {
				tabToUpdate.data = { ...tabToUpdate.data, ...args[1] };
				if (args[1].token) {
					tabToUpdate.token = args[1].token;
				}
			}
			return true;
		});

		// Download & file handlers
		handlers.set("download", (args) => {
			const link = document.createElement("a");
			link.href = args[0];
			link.download = args[1]?.filename || "download";
			link.click();
			return true;
		});

		handlers.set("checkDiskSpace", () => ({
			free: 100 * 1024 * 1024 * 1024,
			size: 500 * 1024 * 1024 * 1024,
		}));

		// Notification handler
		handlers.set("notification", (args) => {
			if ("Notification" in window && Notification.permission === "granted") {
				new Notification(args[0]?.title || "", { body: args[0]?.text || "" });
			}
			return true;
		});

		// Window handlers
		handlers.set("reload", () => {
			window.location.reload();
			return true;
		});

		handlers.set("focusWindow", () => {
			window.focus();
			return true;
		});

		handlers.set("setBadge", (args) => {
			document.title = args[0] ? `(${args[0]}) Planstar` : "Planstar";
			return true;
		});

		// Session handlers
		handlers.set("logout", () => this.clearStorageAndReload());
		handlers.set("exit", () => this.clearStorageAndReload());
		handlers.set("shutdown", () => this.clearStorageAndReload());

		// Clipboard handler
		handlers.set("paste", async () => {
			if (navigator.clipboard) {
				const text = await navigator.clipboard.readText();
				document.execCommand("insertText", false, text);
			}
			return true;
		});

		// Config persistence. These channels carry a bare string, not a partial config, so each one
		// names the field it owns: spreading a string into the config object writes
		// {"0":"d","1":"e",...} and leaves the real field untouched - that is how the language
		// picker silently stopped working.
		const setField =
			(field: "channel" | "interfaceLang"): ApiHandler =>
			(args) => {
				this.config = { ...this.config, [field]: String(args[0] || "") };
				this.storage.set("config", this.config);
				return true;
			};
		handlers.set("setChannel", setField("channel"));
		handlers.set("setUserDataPath", (args) => {
			// getDataPath() reads this key raw, so it is written raw rather than through WebStorage
			localStorage.setItem("anytype_dataPath", String(args[0] || ""));
			return true;
		});
		handlers.set("setInterfaceLang", (args) => {
			const next = String(args[0] || "");
			const changed = next !== this.config.interfaceLang;

			setField("interfaceLang")(args);

			// The desktop's main process restarts the app after a language change, because menus,
			// tooltips and shortcuts are built from translate() while booting. A reload is the
			// web equivalent - without it the picker changes nothing on screen.
			if (changed) {
				window.location.reload();
			}

			return true;
		});

		// No-op handlers that return true
		const noopTrue = () => true;
		["minimize", "maximize", "close", "toggleFullScreen"].forEach((cmd) => {
			handlers.set(cmd, () => {
				console.log("[Web] Window command not supported:", cmd);
				return true;
			});
		});

		["setPinChecked", "pinCheck", "pinSet", "pinRemove"].forEach((cmd) =>
			handlers.set(cmd, noopTrue),
		);
		["setSpellingLang", "spellcheckAdd"].forEach((cmd) =>
			handlers.set(cmd, noopTrue),
		);
		["updateCheck", "updateDownload", "updateConfirm", "updateCancel"].forEach(
			(cmd) => {
				handlers.set(cmd, () => {
					// Legacy string commands predate the bridge and use anytype-era names. Since B2 the
					// update actions live only on the command bus, so each maps onto a command id rather
					// than a direct `window.Desktop` method (those no longer exist).
					const desktop = (
						window as unknown as { Desktop?: Record<string, unknown> }
					).Desktop;
					const exec =
						desktop && typeof desktop.executeCommand === "function"
							? (desktop.executeCommand as (
									id: string,
									payload?: unknown,
								) => unknown)
							: null;
					if (exec) {
						if (cmd === "updateCheck") {
							return exec("check-for-updates");
						}
						if (cmd === "updateDownload") {
							return exec("download-update");
						}
						if (cmd === "updateCancel") {
							return exec("cancel-update-download");
						}
						if (
							cmd === "updateConfirm" &&
							desktop &&
							typeof desktop.getUpdateState === "function"
						) {
							// The banner's confirm means "get me onto the new version": install when the
							// download is already staged, otherwise start (or resume) the download — the
							// shell's state pushes will bring the banner back for the install step.
							return Promise.resolve(
								(desktop.getUpdateState as () => Promise<any>)(),
							).then((state: any) => {
								if (state && state.kind === "update-downloaded") {
									return exec("quit-and-install-update");
								}
								return exec("download-update");
							});
						}
					}
					console.log("[Web] Updates not supported in web mode:", cmd);
					return true;
				});
			},
		);

		// Desktop bridge parity: the shell exposes `window.Desktop.*` methods that the web mock
		// must mirror so renderer code never branches on `isDesktop`. Each entry below is a no-op
		// or a Web-API fallback; the parity check script (`scripts/check-desktop-mock-parity.mjs`)
		// asserts this list stays in sync with `electron/preload/bridge.ts`.
		handlers.set("log", (args) => {
			const level = (args[0] as string) || "info";
			const payload = args[1];
			const fn =
				level === "error"
					? console.error
					: level === "warn"
						? console.warn
						: console.log;
			fn("[renderer]", ...(Array.isArray(payload) ? payload : [payload]));
			return true;
		});

		handlers.set("executeCommand", (args) => {
			const id = args[0] as string;
			// Mirror the subset of commands that make sense in a browser tab.
			switch (id) {
				case "reload":
					window.location.reload();
					return Promise.resolve({ ok: true });
				case "open-external": {
					const url = args[1];
					if (typeof url === "string" && /^https?:\/\//i.test(url)) {
						window.open(url, "_blank");
						return Promise.resolve({ ok: true });
					}
					return Promise.resolve({ ok: false, reason: "invalid-url" });
				}
				// B2: actions that converged onto the command bus. In the browser they degrade to
				// the same "unavailable" shapes the dedicated handlers used to return, so the
				// facade's result adaptation (e.g. downloadUpdate → null) behaves identically.
				case "export-logs":
					return Promise.resolve({ success: false, error: "web-mode" });
				case "capture-screenshot":
					return Promise.resolve({
						png: "",
						width: 0,
						height: 0,
						unsupported: true,
					});
				case "download-update":
				case "cancel-update-download":
				case "quit-and-install-update":
					return Promise.resolve({ ok: false, reason: "web-mode" });
				default:
					console.log("[Web] executeCommand not supported:", id);
					return Promise.resolve({ ok: false, reason: "web-mode" });
			}
		});

		handlers.set("submitFeedback", (args) => {
			const payload = args[0] as { text?: string };
			// Web mode has no userData directory; keep the text in localStorage so nothing the user
			// typed is lost, and report success so the dialog can close with a thank-you.
			try {
				const queue = JSON.parse(
					window.localStorage.getItem("anytype_feedbackQueue") || "[]",
				);
				queue.push({ ...payload, submittedAt: new Date().toISOString() });
				window.localStorage.setItem(
					"anytype_feedbackQueue",
					JSON.stringify(queue.slice(-20)),
				);
			} catch (e) {
				console.warn("[Web] feedback persistence failed:", e);
			}
			return Promise.resolve({ success: true, path: "web-localStorage" });
		});

		handlers.set("getUpdateState", () => Promise.resolve({ kind: "idle" }));
		// The browser has no manifest policy channel, so there is never a forced update to query.
		handlers.set("getForceUpdateState", () => Promise.resolve(null));

		handlers.set("setApplicationLocale", () => true);
		handlers.set("getSystemLocale", () => Promise.resolve("en-US"));
		handlers.set("getZoomLevel", () => Promise.resolve({ zoomLevel: 0 }));

		// Subscription helpers: return a disposer that does nothing, and immediately invoke the
		// callback with a benign payload where the bridge replays the latest value.
		const noopDisposer = () => undefined;
		handlers.set("onOpenFeedbackDialog", () => noopDisposer);
		handlers.set("onUpdateStateChanged", (args) => {
			const cb = args[0] as (state: unknown) => void;
			if (typeof cb === "function") {
				cb({ kind: "idle" });
			}
			return noopDisposer;
		});
		handlers.set("onUpdateCheckResult", () => noopDisposer);
		handlers.set("onForceUpdateRequired", () => noopDisposer);
		handlers.set("onForceUpdateCleared", () => noopDisposer);
		handlers.set("onApplicationLocaleChanged", () => noopDisposer);
		handlers.set("onZoomLevelChanged", () => noopDisposer);
		handlers.set("notifyRendererReady", () => true);

		// Capability snapshot for the web mock (B1): only feedback is genuinely available in the
		// browser (persisted to localStorage); every shell-only subsystem reports false so UI hides
		// those entries instead of calling a method that would only degrade to null.
		handlers.set("getCapabilities", () =>
			Promise.resolve({
				isDesktop: false,
				feedback: true,
				exportLogs: false,
				notifications: false,
				tray: false,
				autoUpdate: false,
				crashReporter: false,
				forceUpdate: false,
				logUpload: false,
			}),
		);

		// No OS-level global shortcuts in the browser - null tells callers to skip
		handlers.set("getGlobalShortcutStatus", () => null);

		[
			"menu",
			"initMenu",
			"setHideTray",
			"setMenuBarVisibility",
			"setHardwareAcceleration",
		].forEach((cmd) => {
			handlers.set(cmd, () => {
				console.log("[Web] Menu/system command not supported:", cmd);
				return true;
			});
		});

		// Single tab in web mode — always return false (no tab to switch to)
		handlers.set("switchToTabByRoute", () => false);
		handlers.set("openRouteInTab", () => false);

		[
			"openTab",
			"openWindow",
			"setActiveTab",
			"removeTab",
			"closeOtherTabs",
			"closeOtherWindows",
			"reorderTabs",
			"setTabsDimmer",
			"winCommand",
			"setAlwaysShowTabs",
		].forEach((cmd) => {
			handlers.set(cmd, () => {
				console.log("[Web] Tab command not supported:", cmd);
				return true;
			});
		});

		[
			"showLinkApproval",
			"hideLinkApproval",
			"linkApprovalResult",
			"linkApprovalSpaces",
		].forEach((cmd) => {
			handlers.set(cmd, () => {
				console.log("[Web] Link approval not supported:", cmd);
				return true;
			});
		});

		handlers.set("payloadBroadcast", noopTrue);
		handlers.set("setBackground", noopTrue);
		handlers.set("setHasPinSet", noopTrue);

		// No-op handlers that return empty object
		["linuxDistro", "shortcutExport", "shortcutImport"].forEach((cmd) => {
			handlers.set(cmd, () => ({}));
		});

		handlers.set("moveNetworkConfig", () => ({
			error: "Not supported in web mode",
		}));

		return handlers;
	}

	private clearStorageAndReload(): true {
		Object.keys(localStorage).forEach((key) => {
			if (key.startsWith("anytype_")) {
				localStorage.removeItem(key);
			}
		});
		window.location.reload();
		return true;
	}

	version = {
		app: "0.0.0-web",
		os: `${navigator.platform} (Web)`,
		system: navigator.userAgent,
		device: "Web Browser",
	};

	// The browser build has no preload, so it stays "web". Inside the real shell the preload installs
	// window.Desktop (isDesktop: true, platform = process.platform, e.g. "darwin") before any page
	// script runs. Deriving it here lets getPlatform() map through Constant.platforms to Mac/Windows/
	// Linux, which is what adds html.platformMac — hard-coding "web" kept every macOS layout rule
	// (titlebar band, traffic-light spacing, drag region) silently off inside the shell.
	platform: string = (() => {
		const bridge = (
			window as unknown as {
				Desktop?: { isDesktop?: boolean; platform?: string };
			}
		).Desktop;

		return bridge?.isDesktop === true
			? String(bridge.platform || "web")
			: "web";
	})();
	arch = "web";
	isPackaged = false;

	storeGet = (key: string) => this.storage.get(key);
	storeSet = (key: string, value: any) => this.storage.set(key, value);
	storeDelete = (key: string) => this.storage.delete(key);

	// Get data path from URL params, localStorage, or window config
	// This path must be writable by the anytypeHelper backend
	private getDataPath = (): string => {
		// Check URL params first
		const urlParams = new URLSearchParams(window.location.search);
		const urlDataPath = urlParams.get("dataPath");
		if (urlDataPath) {
			return urlDataPath;
		}

		// Check localStorage
		const storedPath = localStorage.getItem("anytype_dataPath");
		if (storedPath) {
			return storedPath;
		}

		// Check window config
		if ((window as any).AnytypeGlobalConfig?.dataPath) {
			return (window as any).AnytypeGlobalConfig.dataPath;
		}

		// Default: use a path in user's home directory
		// This will be resolved by the backend based on OS
		return "";
	};

	userPath = () => this.getDataPath();
	tmpPath = () => "/tmp";
	downloadPath = () =>
		this.getDataPath()
			? `${this.getDataPath()}/downloads`
			: "/tmp/anytype-web/downloads";
	logPath = () =>
		this.getDataPath() ? `${this.getDataPath()}/logs` : "/tmp/anytype-web/logs";
	defaultPath = () => this.getDataPath();

	dirName = (fp: string) => fp.substring(0, fp.lastIndexOf("/"));
	filePath = (...args: string[]) => args.join("/");
	fileName = (fp: string) => fp.substring(fp.lastIndexOf("/") + 1);
	fileMime = (_fp: string) => "application/octet-stream";
	fileExt = (fp: string) => {
		const idx = fp.lastIndexOf(".");
		return idx >= 0 ? fp.substring(idx + 1) : "";
	};
	fileSize = (_fp: string) => 0;
	isDirectory = (_fp: string) => false;

	getTheme = () => this.config.theme || "";

	/**
	 * The shell's own config, as the entry point must publish it: `S.Common.config` prefers
	 * `window.AnytypeGlobalConfig` over the store's copy, so anything the entry does not put there
	 * is invisible to the app - which is how a stored `interfaceLang` never reached the UI.
	 */
	getConfig = (): MockConfig => ({ ...this.config });
	getBgColor = () => (this.config.theme === "dark" ? "#171717" : "#fff");

	tabId = () => this.tabId_;

	currentWindow = () => ({
		windowId: this.windowId,
		isFocused: () => document.hasFocus(),
		isFullScreen: () => !!document.fullscreenElement,
	});

	isFocused = () => document.hasFocus();
	isFullScreen = () => !!document.fullscreenElement;

	focus = () => window.focus();

	getGlobal = (key: string) => {
		if (key === "serverAddress") {
			// The entry point publishes the address it resolved; the fallback is the API base,
			// since the retired gRPC-web proxy is not dialled any more. Dispatcher.init refuses
			// an empty address, so this must never return ''.
			return (
				(window as any).AnytypeGlobalConfig?.serverAddress || serverAddress()
			);
		}
		return null;
	};

	showOpenDialog = async (options: any) => {
		// Use the File System Access API if available
		if ("showOpenFilePicker" in window) {
			try {
				const handles = await (window as any).showOpenFilePicker({
					multiple: options?.properties?.includes("multiSelections"),
					types: options?.filters?.map((f: any) => ({
						description: f.name,
						accept: {
							"*/*": f.extensions?.map((e: string) => "." + e) || ["*"],
						},
					})),
				});
				const files: File[] = await Promise.all(
					handles.map((h: any) => h.getFile()),
				);

				// Upload files to server to get real filesystem paths
				const filePaths = await Promise.all(
					files.map((f) => uploadFileToServer(f)),
				);

				return {
					canceled: false,
					filePaths,
					files,
				};
			} catch (e) {
				console.log("[Web] Canceled or error:", e);
				return { canceled: true, filePaths: [] };
			}
		}

		// Fallback to input element
		return new Promise((resolve) => {
			const input = document.createElement("input");
			input.type = "file";
			input.multiple = options?.properties?.includes("multiSelections");
			input.onchange = async () => {
				const files = Array.from(input.files || []);
				if (files.length === 0) {
					resolve({ canceled: true, filePaths: [], files: [] });
					return;
				}

				try {
					// Upload files to server to get real filesystem paths
					const filePaths = await Promise.all(
						files.map((f) => uploadFileToServer(f)),
					);
					resolve({
						canceled: false,
						filePaths,
						files,
					});
				} catch (e) {
					console.error("[showOpenDialog] Upload error:", e);
					resolve({ canceled: true, filePaths: [], files: [] });
				}
			};
			input.click();
		});
	};

	webFilePath = (file: File) => file.name;

	// The drop handlers (component/drag/provider.tsx) collect paths synchronously, but a browser
	// File has no path: staging it through the same upload ingress the picker uses is the only
	// way a server-side command can read the bytes. Desktop has no such method and keeps its
	// real paths, so callers feature-detect rather than branch on the platform.
	uploadStaged = async (files: File[]) =>
		Promise.all(files.map((file) => uploadFileToServer(file)));

	fileWrite = (name: string, data: any, _options?: any) => {
		// Create a blob and download it
		const blob = new Blob([data]);
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = name;
		a.click();
		URL.revokeObjectURL(url);
		return name;
	};

	on = (event: string, callback: EventCallback) => {
		if (!this.eventListeners.has(event)) {
			this.eventListeners.set(event, new Set());
		}
		this.eventListeners.get(event)!.add(callback);
	};

	removeAllListeners = (event: string) => {
		this.eventListeners.delete(event);
	};

	emit = (event: string, ...args: any[]) => {
		const listeners = this.eventListeners.get(event);
		if (listeners) {
			listeners.forEach((cb) => cb(null, ...args));
		}
	};

	Api = async (_id: number, cmd: string, args: any[] = []): Promise<any> => {
		const handler = this.apiHandlers.get(cmd);
		if (handler) {
			return handler(args);
		}
		console.log("[Web] Unknown API command:", cmd, args);
		return null;
	};

	/**
	 * Mount the same method surface the Electron preload exposes as `window.Desktop`, so the
	 * renderer's `Lib/desktop` facade has a single bridge to talk to in BOTH modes instead of a
	 * dead `window.Desktop` in the browser. Each method forwards to the matching parity handler
	 * registered in `initApiHandlers` (the same map `Api()` dispatches through), so there is one
	 * implementation per capability and the parity script keeps it honest.
	 *
	 * Guarded on `window.Desktop` already being present: in the real Electron shell the preload
	 * installs the genuine bridge (isDesktop: true) before any page script runs, and this mock must
	 * never shadow it. Only the browser build — where no preload ran — gets the mock facade, which
	 * reports `isDesktop: false` so `desktop.isShell()` still distinguishes the two.
	 */
	installDesktopFacade = (): void => {
		if ((window as any).Desktop) {
			return;
		}

		const call = (name: string, args: any[]) => {
			const handler = this.apiHandlers.get(name);
			return handler ? handler(args) : undefined;
		};

		(window as any).Desktop = {
			isDesktop: false,
			platform: this.platform,
			electronVersion: "",
			chromeVersion: "",

			executeCommand: (id: string, payload?: unknown) =>
				call("executeCommand", [id, payload]),
			log: (level: string, args: unknown[]) => call("log", [level, args]),
			getCapabilities: () => call("getCapabilities", []),

			setApplicationLocale: (locale: string) =>
				call("setApplicationLocale", [locale]),
			getSystemLocale: () => call("getSystemLocale", []),
			getZoomLevel: () => call("getZoomLevel", []),
			onApplicationLocaleChanged: (cb: any) =>
				call("onApplicationLocaleChanged", [cb]),
			onZoomLevelChanged: (cb: any) => call("onZoomLevelChanged", [cb]),

			submitFeedback: (payload: any) => call("submitFeedback", [payload]),
			onOpenFeedbackDialog: (cb: any) => call("onOpenFeedbackDialog", [cb]),

			getUpdateState: () => call("getUpdateState", []),
			onUpdateStateChanged: (cb: any) => call("onUpdateStateChanged", [cb]),
			onUpdateCheckResult: (cb: any) => call("onUpdateCheckResult", [cb]),
			onForceUpdateRequired: (cb: any) => call("onForceUpdateRequired", [cb]),
			getForceUpdateState: () => call("getForceUpdateState", []),
			onForceUpdateCleared: (cb: any) => call("onForceUpdateCleared", [cb]),

			notifyRendererReady: () => call("notifyRendererReady", []),
		};
	};
}

export const electronMock = new ElectronMock();
export default electronMock;
