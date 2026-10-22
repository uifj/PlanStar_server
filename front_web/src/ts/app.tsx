import {
	DragProvider,
	ListMenu,
	ListNotification,
	ListPopup,
	Page,
	Preview as PreviewIndex,
	RecoveryStatus,
	SelectionProvider,
	SidebarLeft,
	Toast,
	UpdateBanner,
} from "Component";
import * as I from "Interface";
import Animation from "Lib/animation";
import { getSession } from "Lib/api/better-auth";
import type { ForceUpdateRequiredPayload } from "Lib/desktop";
import { desktop } from "Lib/desktop";
import Download from "Lib/download";
import { watchForceUpdate } from "Lib/forceUpdateWatcher";
import { approvalSpaces } from "Lib/linkApproval";
import { membership } from "Lib/membership";
import { powerState } from "Lib/powerState";
import { clearReactionQueue, scheduleReaction } from "Lib/reactionScheduler";
import Storage from "Lib/storage";
import { sharedRoute } from "Lib/web/deepLink";
import * as M from "Model";
import * as Sentry from "@sentry/browser";
import * as hs from "history";
import { comparer, configure, reaction } from "mobx";
import raf from "raf";
import React, {
	type FC,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { RouteComponentProps } from "react-router";
import { Route, Router, Switch } from "react-router-dom";

configure({
	enforceActions: "never",
	reactionScheduler: (f) => scheduleReaction(f),
});

import "katex/dist/katex.min.css";
import "prismjs/themes/prism.css";
import "css/theme/dark/prism.css";
import "react-virtualized/styles.css";
import "swiper/css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
// Frozen legacy stylesheet: the compiled output of the deleted scss/common.scss +
// scss/desktop/titlebar.scss pair. Shrink it by porting rules to Tailwind, never by editing it.
import "../styles/legacy.css";
// Tailwind v4 (theme + utilities, no preflight) for the migrated ZCode-style shell surfaces.
import "../styles/desktop.css";

const memoryHistory = hs.createMemoryHistory;
const history = (window as any).__anytypeHistory || memoryHistory();
(window as any).__anytypeHistory = history;
const electron = U.Common.getElectron();
const isPackaged = electron.isPackaged;

declare global {
	interface Window {
		isExtension: boolean;
		$: any;
		Electron: any;
		Anytype: any;

		isWebVersion: boolean;
		Config: any;
		AnytypeGlobalConfig: I.AppConfig;
	}
}

declare global {}

if (!isPackaged) {
	window.Anytype = {
		Lib: {
			I,
			C,
			S,
			U,
			M,
			J,
			analytics,
			dispatcher,
			keyboard,
			Renderer,
			Preview,
			Storage,
			Animation,
			Onboarding,
			Survey,
			Encode,
			Decode,
			translate,
			sidebar,
			Action,
		},
	};
}

/*
spy(event => {
	if (event.type == 'action') {
		console.log('[Mobx].event', event.name, event.arguments);
	};
});
enableLogging({
	predicate: () => true,
	action: true,
	reaction: true,
	transaction: true,
	compute: true,
});
*/

// The web build ships no DSN unless the operator supplies one, and Sentry.init with an empty dsn is a
// no-op client that still installs the global error handlers and warns on every boot — so the client is
// only built when a destination was named.
if (SENTRY_DSN) {
	Sentry.init({
		release: electron.version.app,
		environment: isPackaged ? "production" : "development",
		dsn: SENTRY_DSN,
		maxBreadcrumbs: 20,
		beforeSend: (e: any) => {
			e.request.url = "";
			return e;
		},
		integrations: [
			new Sentry.Integrations.GlobalHandlers({
				onerror: true,
				onunhandledrejection: true,
			}),
		],
	});

	Sentry.setContext("info", {
		network: I.NetworkMode[S.Auth.networkConfig?.mode],
		isPackaged: isPackaged,
	});
}

const RoutePage: FC<RouteComponentProps> = (props) => {
	return <Page {...props} isPopup={false} />;
};

const App: FC = () => {
	const [isLoading, setIsLoading] = useState(true);
	const nodeRef = useRef(null);
	const cancelSelectRef = useRef<() => void>(null);
	const isSelectCancelled = useRef(false);
	// Mirrors the state below: the RPC callback runs before React commits it, and Cancel must
	// already be refused in that window
	const isSelectDoneRef = useRef(false);
	const [isSelectDone, setIsSelectDone] = useState(false);

	const init = () => {
		const { version, arch, getGlobal, tabId } = electron;

		U.Perf.step("boot:init", "boot:entry");

		U.Router.init(history);
		U.Smile.init();

		// Keep <html> class in sync with history even if React Router's subscription
		// gets desynced (e.g. after HMR module swaps). Without this, the tree can end
		// up on the wrong page after an HMR full-reload with the tab route restored.
		history.listen(() => keyboard.setBodyClass());

		if (window.isWebVersion) {
			import("./lib/web/routeSync").then(({ initRouteSync }) =>
				initRouteSync(history, U.Router),
			);
		}

		keyboard.init();
		registerIpcEvents();
		registerDesktopBridge();

		const startWithAddress = (address: string) => {
			console.log("[App] Init", address);

			U.Perf.step("boot:server", "boot:init");

			// The helper requires this on the account-bootstrap RPCs. The main
			// process gave it to the helper on its stdin before it started serving,
			// so it is published by the time any address exists
			dispatcher.init(address, getGlobal("localApiSecret"));
			Renderer.send("getInitData", tabId()).then((data: any) => {
				U.Perf.step("boot:init-data", "boot:init");
				onInit(data);
			});
		};

		// Windows are created in parallel with middleware startup: use the
		// address directly when the server is already up (also covers web
		// mode), otherwise await it from the main process
		const address = getGlobal("serverAddress");

		if (address) {
			startWithAddress(address);
		} else {
			// Rejection means the middleware failed to start — the main process
			// shows an error dialog in that case
			Renderer.send("getServerAddress")
				.then(startWithAddress)
				.catch((err: any) => {
					console.error("[App] Server failed to start:", err);
				});
		}

		console.log("[Process] os version:", version.system, "arch:", arch);
		console.log("[App] version:", version.app, "isPackaged", isPackaged);
	};

	const registerIpcEvents = () => {
		unregisterIpcEvents();

		Renderer.on("route", (e: any, route: string) => onRoute(route));
		Renderer.on("popup", onPopup);

		// Legacy anytype-era update channel. In the real Electron shell the autoUpdater only emits
		// the typed facade channels (UpdateStateChanged / UpdateCheckResult), which registerDesktopBridge
		// below consumes — so wiring the legacy strings there too would risk a double response for the
		// same update. The shell therefore relies solely on the facade; these subscriptions stay only
		// for the browser build, where the legacy mock path is the sole update signal.
		if (!desktop.isShell()) {
			Renderer.on("update-not-available", onUpdateUnavailable);
			Renderer.on("update-downloaded", onUpdateDownloaded);
			Renderer.on("update-error", onUpdateError);
			Renderer.on("download-started", onDownloadStarted);
			Renderer.on("download-progress", onUpdateProgress);
		}

		// Gateway file downloads: the middleware has no process behind them, so
		// the renderer owns their progress rows. Events are broadcast to every
		// tab; only the one holding the id has a row to update
		Renderer.on("file-download-progress", (e: any, data: any) =>
			Download.onProgress(data),
		);
		Renderer.on("file-download-done", (e: any, data: any) =>
			Download.onDone(data),
		);
		Renderer.on("spellcheck", onSpellcheck);
		Renderer.on("pin-set", () => S.Common.pinInit());
		Renderer.on("pin-remove", () => S.Common.pinInit());
		Renderer.on("pin-unlocked", () => {
			const wasPinChecked = keyboard.isPinChecked;

			keyboard.isPinChecked = true;

			if (wasPinChecked) {
				return;
			}

			const { redirect } = S.Common;
			const { account } = S.Auth;

			if (account) {
				redirect ? U.Router.go(redirect, {}) : U.Space.openDashboard();
			}

			S.Common.redirectSet("");
		});
		Renderer.on("link-approval-decision", onLinkApprovalDecision);
		Renderer.on("enter-full-screen", () => S.Common.fullscreenSet(true));
		Renderer.on("leave-full-screen", () => S.Common.fullscreenSet(false));
		Renderer.on("config", (e: any, config: any) =>
			S.Common.configSet(config, true),
		);
		Renderer.on("logout", () => S.Auth.logout(false, false));
		Renderer.on("data-path", (e: any, p: string) => S.Common.dataPathSet(p));
		Renderer.on("close-session", onCloseSession);
		Renderer.on("set-pinned", (e: any, v: boolean) => S.Common.isPinnedSet(v));
		Renderer.on("set-single-tab", (e: any, v: boolean) => {
			S.Common.singleTabSet(v);
			keyboard.setBodyClass();
		});
		Renderer.on("notification-callback", onNotificationCallback);
		Renderer.on("payload-broadcast", onPayloadBroadcast);
		Renderer.on("set-active-tab", (e: any, id: string) => {
			const isActive = id === S.Common.tabId;

			S.Common.isActiveTabSet(isActive);

			if (isActive) {
				U.Data.updateTabsDimmer();
			}
		});

		Renderer.on("shutdownStart", () => {
			setIsLoading(true);
			Storage.delete("menuSearchText");
		});

		Renderer.on("zoom", () => {
			sidebar.resizePage(false, null, null, false);
			sidebar.resizePage(true, null, null, false);
		});

		Renderer.on("native-theme", (e: any, isDark: boolean) => {
			S.Common.nativeThemeSet(isDark);
			S.Common.themeSet(S.Common.theme);
		});

		Renderer.on("set-theme", (e: any, theme: string) => {
			S.Common.themeSet(theme);
		});

		Renderer.on("set-hide-sidebar", (e: any, v: boolean) => {
			S.Common.hideSidebarSet(v);
			sidebar.init(false);
		});

		// every tab publishes its own typing, so the setting has to reach all of them
		Renderer.on("set-send-typing", (e: any, v: boolean) => {
			S.Common.sendTypingSet(v);
		});

		Renderer.on("pin-check", () => {
			if (!S.Common.pin) {
				return;
			}

			S.Common.redirectSet(U.Router.getRoute());
			keyboard.setPinChecked(false);
			U.Router.go("/auth/pin-check", {});
		});

		Renderer.on("reload", () => {
			Renderer.send("reload", U.Router.getRoute());
		});

		Renderer.on("power-event", (e: any, state: string, seq: number) => {
			powerState.onEvent(state, seq, "live");

			if (state == "resume") {
				membership.trigger("resume");
			}
		});

		Renderer.on("tab-show-tooltip", (e: any, data: any) =>
			U.Common.tabTooltipShow(data),
		);
		Renderer.on("tab-hide-tooltip", () => U.Common.tabTooltipHide());
		Renderer.on("analytics", (e: any, code: string, data?: any) =>
			analytics.event(code, data),
		);
	};

	const unregisterIpcEvents = () => {
		Renderer.remove("init");
		Renderer.remove("route");
		Renderer.remove("popup");
		Renderer.remove("update-not-available");
		Renderer.remove("update-downloaded");
		Renderer.remove("update-error");
		Renderer.remove("download-started");
		Renderer.remove("download-progress");
		Renderer.remove("file-download-progress");
		Renderer.remove("file-download-done");
		Renderer.remove("spellcheck");
		Renderer.remove("pin-set");
		Renderer.remove("pin-remove");
		Renderer.remove("pin-unlocked");
		Renderer.remove("enter-full-screen");
		Renderer.remove("leave-full-screen");
		Renderer.remove("config");
		Renderer.remove("logout");
		Renderer.remove("data-path");
		Renderer.remove("will-close-window");
		Renderer.remove("shutdownStart");
		Renderer.remove("zoom");
		Renderer.remove("native-theme");
		Renderer.remove("set-pinned");
		Renderer.remove("pin-check");
		Renderer.remove("reload");
		Renderer.remove("power-event");
		Renderer.remove("tab-show-tooltip");
		Renderer.remove("tab-hide-tooltip");
		Renderer.remove("set-active-tab");
		Renderer.remove("analytics");
		unregisterDesktopBridge();
	};

	/**
	 * Desktop bridge integration (window.Desktop facade from Lib/desktop).
	 *
	 * The legacy `Renderer.on` channels above are the anytype-era string protocol served by
	 * electronMock; the subscriptions below are the typed shell pushes installed by the Electron
	 * preload. Both stay wired: the mock keeps serving web mode, the facade serves the shell, and
	 * neither path needs an `isDesktop` branch at the call site.
	 */
	const desktopBridgeUnsubscribes = useRef<(() => void)[]>([]);
	// Bumped on every register/unregister so an in-flight `capabilities()` response from a stale
	// cycle is dropped instead of writing subscriptions that were already torn down.
	const desktopBridgeGeneration = useRef(0);

	const registerDesktopBridge = () => {
		unregisterDesktopBridge();

		// Lets main flush a deep-link route that arrived before the renderer finished booting.
		desktop.notifyRendererReady();

		// Capability-gated wiring (B1): ask the shell which desktop subsystems are enabled and only
		// subscribe the UI for those, so the renderer's desktop surface is an explicit function of the
		// shell's feature flags rather than "main happens not to emit". `caps === null` (web mode / no
		// bridge) wires everything: the web mock serves each channel as a benign no-op and is the
		// browser build's only update/feedback signal. Locale and zoom are never flag-gated.
		const generation = ++desktopBridgeGeneration.current;
		void desktop.capabilities().then((caps) => {
			if (generation !== desktopBridgeGeneration.current) {
				return;
			}

			const wantUpdate = caps === null || caps.autoUpdate;
			const wantForceUpdate = caps === null || caps.forceUpdate;
			const wantFeedback = caps === null || caps.feedback;

			const unsubs: (() => void)[] = [];

			// Update state → the existing UpdateBanner (S.Common.updateVersion) and progress row.
			if (wantUpdate) {
				unsubs.push(
					desktop.onUpdateStateChanged((state) => {
						switch (state.kind) {
							case "available":
							case "update-downloaded":
								S.Common.updateVersionSet(state.version);
								S.Progress.delete(I.ProgressType.Update);
								break;

							case "downloading":
								S.Progress.update({
									id: I.ProgressType.Update,
									type: I.ProgressType.Update,
									current: state.progress,
									total: 100,
								});
								break;

							default:
								S.Common.updateVersionSet("");
								S.Progress.delete(I.ProgressType.Update);
						}
					}),
				);

				// Manual "Check for updates" (native menu or sync-status menu) deserves visible feedback;
				// automatic polls stay silent like the legacy `auto` flag did.
				unsubs.push(
					desktop.onUpdateCheckResult((result) => {
						if (!result.manualWebContentsId) {
							return;
						}

						if (result.status == "not-available") {
							onUpdateUnavailable(null, false);
						} else if (result.status == "error") {
							onUpdateError(
								null,
								result.message || "update check failed",
								false,
								false,
							);
						}
					}),
				);
			}

			// Stage 6 guard: blocking modal, no dimmer/escape dismissal. S.Popup.open dedupes by id,
			// so repeated broadcasts (and the bridge's replay-latest) never stack popups.
			if (wantForceUpdate) {
				const openForceUpdate = (payload: ForceUpdateRequiredPayload) => {
					S.Popup.open("forceUpdate", {
						data: {
							version: payload.version,
							releaseNotes: payload.releaseNotes,
						},
						className: "popupConfirm",
						preventCloseByClick: true,
						preventCloseByEscape: true,
						// The guard owns this modal: a page unmounting while the app is still booting (and
						// any later route change) closes everything else, not the block. Retraction still
						// closes it explicitly through S.Popup.close below.
						preventCloseAll: true,
					});
				};

				// Subscribes first, then asks for the current state: a window rebuilt after the broadcast
				// still gets the block, and a retraction that lands in between closes it. The wiring itself is
				// tested in Lib/forceUpdateWatcher.test.ts.
				unsubs.push(
					watchForceUpdate(desktop, {
						open: openForceUpdate,
						close: () => S.Popup.close("forceUpdate"),
						isCurrent: () => generation === desktopBridgeGeneration.current,
					}),
				);
			}

			if (wantFeedback) {
				unsubs.push(
					desktop.onOpenFeedbackDialog(() => {
						S.Popup.open("feedback", {
							data: {},
							className: "popupSubmitReport",
						});
					}),
				);
			}

			// Menu locale switch → follow with the UI language, through the same path the settings
			// picker uses. The bridge does not replay the persisted locale, so every emission is a
			// real menu action and must apply immediately.
			unsubs.push(
				desktop.onApplicationLocaleChanged((locale) => {
					if (locale != S.Common.interfaceLang) {
						Action.setInterfaceLang(locale);
					}
				}),
			);

			// Main already applied webContents zoom; the renderer only recomputes layout, mirroring
			// the legacy 'zoom' event above.
			unsubs.push(
				desktop.onZoomLevelChanged(() => {
					sidebar.resizePage(false, null, null, false);
					sidebar.resizePage(true, null, null, false);
				}),
			);

			desktopBridgeUnsubscribes.current = unsubs;
		});
	};

	const unregisterDesktopBridge = () => {
		// Invalidate any in-flight capabilities() response from the cycle being torn down.
		desktopBridgeGeneration.current++;
		for (const unsubscribe of desktopBridgeUnsubscribes.current) {
			try {
				unsubscribe();
			} catch (e) {
				/** best effort */
			}
		}
		desktopBridgeUnsubscribes.current = [];
	};

	const onInit = (data: any) => {
		data = data || {};

		const {
			id,
			dataPath,
			config,
			isDark,
			languages,
			isPinChecked,
			isPinned,
			css,
			isSingleTab,
			activeTabId,
		} = data;
		const body = document.body;
		const node = nodeRef.current;
		const bubbleLoader = U.Dom.get("bubble-loader");
		const rootLoader = U.Dom.select("#root-loader", node);
		const anim = U.Dom.select(".anim", rootLoader);
		const accountId = Storage.get("accountId");
		const redirect = Storage.get("redirect");
		const tabId = electron.tabId();

		// Validate tab route — don't restore blank/void/auth routes.
		//
		// Memory history is created empty on a cold boot, so on web the address bar is the only
		// record of what the user reloaded or shared: prefer it when it names an app route, and fall
		// back to the stored redirect for the windows that never had one. The helper keeps the query
		// string, which is where the app's routes carry their parameters (`/main/object/?id=…`).
		let route = String(
			sharedRoute(window.location) || data.route || redirect || "",
		);

		if (route) {
			const rp = U.Router.getParam(route);
			if (
				rp.page == "auth" ||
				(rp.page == "main" && ["blank", "void"].includes(rp.action))
			) {
				route = "";
			}
		}

		// Resolve the system theme before themeSet updates CSS and the native background.
		S.Common.nativeThemeSet(isDark);

		if (config) {
			S.Common.configSet(config, true);
			S.Common.themeSet(config.theme);
		}

		S.Common.languagesSet(languages);
		S.Common.dataPathSet(dataPath);
		S.Common.windowIdSet(id);
		S.Common.tabIdSet(tabId);
		S.Common.isActiveTabSet(activeTabId === tabId);
		S.Common.setLeftSidebarState("vault", "");
		S.Common.isPinnedSet(isPinned || false);
		S.Common.singleTabSet(isSingleTab);

		// One-time unsafe data location popup: gate on active tab (onInit runs per tab), delay past the boot loader
		if (S.Common.isActiveTab) {
			window.setTimeout(() => Action.vaultLocationWarningOnStart(), 3000);
		}

		U.Data.updateTabsDimmer();

		Action.checkDefaultSpellingLang();
		keyboard.setBodyClass();

		sidebar.init(false);
		analytics.init();

		U.Perf.step("boot:stores", "boot:init-data");

		const lastAppVersion = Storage.get("lastAppVersion");
		const currentAppVersion = electron.version?.app;

		if (
			lastAppVersion &&
			currentAppVersion &&
			lastAppVersion !== currentAppVersion
		) {
			analytics.event("UpgradeVersion");
		}

		if (currentAppVersion) {
			Storage.set("lastAppVersion", currentAppVersion);
		}

		if (redirect) {
			Storage.delete("redirect");
		}

		if (css && !config.disableCss) {
			U.Dom.injectCss("anytype-custom-css", css);
		}

		U.Dom.addClass(body, "over");

		let measured = false;
		const hide = () => {
			if (!measured) {
				measured = true;
				U.Perf.step("boot:ready", "boot:entry");
			}

			// React owns #root-loader, so it must do the removal: detaching it here and letting the
			// state update commit afterwards makes React remove a node that is no longer its
			// child, which throws in the commit phase and takes the whole app to the error
			// boundary. Unmounting also stops the status block's observer and timer
			setIsLoading(false);

			bubbleLoader?.remove();
			U.Dom.removeClass(body, "over");
		};
		const routeParam = { replace: true, onRouteChange: hide };

		// Cancel on the start-up loader: the logout calls AccountStop, which makes the pending
		// AccountSelect return, and the auth landing replaces the loader, the same path the setup
		// page's Back button takes
		cancelSelectRef.current = () => {
			if (isSelectCancelled.current || isSelectDoneRef.current) {
				return;
			}

			isSelectCancelled.current = true;
			S.Auth.logout(true, false);
			U.Router.go("/auth/select", routeParam);
		};

		const cb = () => {
			const t = 300;

			if (bubbleLoader) {
				U.Dom.css(bubbleLoader, { transitionDuration: `${t}ms` });
				U.Dom.addClass(bubbleLoader, "inflate");
			}
			if (anim) {
				U.Dom.css(anim, { transitionDuration: `${t}ms` });
			}

			window.setTimeout(() => {
				raf(() => U.Dom.removeClass(anim, "from"));
				window.setTimeout(() => {
					U.Dom.addClass(anim, "to");

					window.setTimeout(() => {
						if (rootLoader) U.Dom.css(rootLoader, { opacity: "0" });
						window.setTimeout(() => hide(), t);
					}, 0);
				}, t * 5);
			}, t * 3);
		};

		const onObtainToken = (token: string) => {
			if (!token) {
				S.Common.redirectSet(route);
				U.Router.go("/auth/setup/init", routeParam);
				return;
			}

			const { dataPath } = S.Common;
			const { networkConfig } = S.Auth;
			const { mode, path: networkPath, preferYamux } = networkConfig;
			const param = route ? U.Router.getParam(route) : {};
			const spaceId =
				param.spaceId ||
				data.spaceId ||
				Storage.getAccountKey("spaceId", false, accountId) ||
				"";

			S.Auth.tokenSet(token);
			C.AccountSelect(
				accountId,
				dataPath,
				mode,
				networkPath,
				preferYamux,
				spaceId,
				(message: any) => {
					// A logout from here on would strand the boot that is already under way; the rest
					// of the run stays visible in the vault's progress block
					isSelectDoneRef.current = true;
					setIsSelectDone(true);

					if (isSelectCancelled.current) {
						return;
					}

					if (message.error.code) {
						console.error("[App.onInit]:", message.error.description);
						S.Common.redirectSet(route);
						U.Router.go("/auth/setup/init", routeParam);
						return;
					}

					const { account } = message;

					if (!account) {
						console.error("[App.onInit]: Account not found");
						S.Common.redirectSet(route);
						U.Router.go("/auth/setup/init", routeParam);
						return;
					}

					U.Perf.step("boot:account", "boot:init");

					keyboard.setPinChecked(isPinChecked);
					S.Auth.accountSet(account);
					S.Common.redirectSet(route);
					S.Common.configSet(account.config, false);

					U.Data.onInfo(account.info);
					S.Common.spaceSet("");

					// A tab that resumes with a stored token never passes through
					// WalletCreateSession, which is where the desktop opened the event stream:
					// without this the restored window has no server->client channel at all.
					dispatcher.startStream();

					// The quick search panel boots spaceless: global search is cross-space by
					// design and results open in the main window, so WorkspaceOpen, the
					// per-space subscriptions and the chat/notification side loads would only
					// pay for UI this window never renders
					if (param.page == "main" && param.action == "quickSearch") {
						U.Data.onAuthQuickSearch(route, routeParam);
						return;
					}

					U.Data.onAuthOnce();

					if (spaceId) {
						U.Router.switchSpace(spaceId, route, false, routeParam, true);
					} else {
						U.Data.onAuthWithoutSpace(routeParam);
					}
				},
			);
		};

		// Lean web boot: no wallet, mnemonic or middleware token. Once the Better Auth
		// session is known, drive the same command sequence the desktop runs after
		// AccountSelect, then let switchSpace open the space and land on the empty
		// dashboard. The command shim authenticates with the session cookie, so the
		// token is only a placeholder for the shell's token guard.
		const bootWebAccount = (toLogin: () => void) => {
			S.Auth.tokenSet("web-session");

			C.AccountSelect("", "", 0, "", false, "", (message: any) => {
				if (message.error.code || !message.account) {
					console.error("[App.bootWebAccount]:", message.error?.description);
					toLogin();
					return;
				}

				const { account } = message;

				S.Auth.accountSet(account);
				S.Common.configSet(account.config, false);
				U.Data.onInfo(account.info);
				S.Common.spaceSet("");
				U.Data.onAuthOnce();

				// The desktop opens the event stream inside WalletCreateSession, which web
				// boot never reaches: without this the client has no server->client channel,
				// so presence, chat status and every list delta stay silent.
				dispatcher.startStream();

				// A reload or a shared link names both the space and the object in the URL, and the
				// desktop boot already honours them (onObtainToken). Dropping the route here is what
				// sent every web reload to the widgets page. An empty route still keeps onSpaceSwitch
				// off the "restorable" path, so a bare boot lands on the dashboard.
				const webParam = route ? U.Router.getParam(route) : {};

				U.Router.switchSpace(
					webParam.spaceId || account.info.accountSpaceId,
					route,
					false,
					routeParam,
					true,
				);
			});
		};

		// The web build always authenticates through the Hono backend's Better Auth
		// session; a stale accountId in storage must never route it into the desktop
		// keychain flow. Desktop keeps the wallet flow until the native transport is
		// retired.
		if (window.isWebVersion) {
			const toLogin = () =>
				U.Router.go("/auth/better-login", { replace: true, onRouteChange: cb });

			getSession()
				.then(({ data: session }) => {
					if (!session) {
						toLogin();
						return;
					}

					bootWebAccount(toLogin);
				})
				.catch((err: any) => {
					console.error("[App.onInit] Better Auth session check failed:", err);
					toLogin();
				});
			return;
		}

		if (!accountId) {
			U.Router.go("/auth/select", { replace: true, onRouteChange: cb });
			return;
		}

		Renderer.send("getTab", tabId).then((tab: any) => {
			if (tab && tab.token) {
				onObtainToken(tab.token);
			} else {
				Renderer.send("keytarGet", accountId)
					.then((phrase: string) => {
						// If phrase is null/empty (can happen on Windows after sleep/reboot when
						// Credential Manager fails), redirect to login
						if (!phrase) {
							console.warn(
								"[App] Failed to retrieve phrase from keychain, redirecting to login",
							);
							S.Common.redirectSet(route);
							U.Router.go("/auth/setup/init", routeParam);
							return;
						}

						U.Data.createSession(phrase, "", "", (message: any) => {
							if (message.error.code) {
								S.Common.redirectSet(route);
								U.Router.go("/auth/setup/init", routeParam);
								return;
							}

							onObtainToken(message.token);
						});
					})
					.catch((err: any) => {
						console.error("[App] Error retrieving phrase from keychain:", err);
						S.Common.redirectSet(route);
						U.Router.go("/auth/setup/init", routeParam);
					});
			}
		});
	};

	const onCloseSession = (e: any, tabId: string) => {
		const currentTabId = electron.tabId();

		clearReactionQueue();
		U.Data.closeSession(() => {
			Renderer.sendIpc("tab-session-closed", tabId || currentTabId);
		});
	};

	const onNotificationCallback = (e: any, cmd: string, payload: any) => {
		switch (cmd) {
			case "openChat": {
				U.Object.openRoute(payload);
				analytics.event("OpenChatFromNotification");
				break;
			}
		}
	};

	const onPayloadBroadcast = (e: any, payload: any) => {
		switch (payload.type) {
			case "openObject": {
				const { object } = payload;

				U.Object.openAuto(object);
				analytics.createObject(
					object.type,
					object.layout,
					analytics.route.webclipper,
					0,
				);
				break;
			}

			case "analyticsEvent": {
				const { code, param } = payload;

				analytics.event(code, param);
				break;
			}
		}
	};

	const onPopup = (e: any, id: string, param: any, close?: boolean) => {
		if (J.Constant.popupPinIds.includes(id) && !keyboard.isPinChecked) {
			return;
		}

		param = param || {};
		param.data = param.data || {};
		param.data.rootId = keyboard.getRootId();

		if (close) {
			S.Popup.closeAll();
		}

		window.setTimeout(() => S.Popup.open(id, param), S.Popup.getTimeout());
	};

	const onUpdateDownloaded = (e: any, info: any) => {
		console.log("[App.onUpdateDownloaded]", info);
		S.Common.updateVersionSet(info?.version);
		S.Progress.delete(I.ProgressType.Update);
	};

	const onUpdateUnavailable = (e: any, auto: boolean) => {
		if (auto) {
			return;
		}

		S.Popup.open("confirm", {
			data: {
				iconParam: { name: "popup/header/updated", color: "lime" },
				title: translate("popupConfirmUpdateDoneTitle"),
				text: U.String.sprintf(
					translate("popupConfirmUpdateDoneText"),
					electron.version.app,
				),
				textConfirm: translate("popupConfirmUpdateDoneOk"),
				colorConfirm: "blank",
				canCancel: false,
			},
		});
	};

	const onDownloadStarted = () => {
		analytics.event("StartUpgradeDownload");
	};

	const onUpdateError = (
		e: any,
		err: string,
		auto: boolean,
		isDownloading: boolean,
	) => {
		console.error(err);
		S.Common.updateVersionSet("");
		S.Progress.delete(I.ProgressType.Update);

		if (auto) {
			return;
		}

		S.Popup.open("confirm", {
			data: {
				iconParam: { name: "popup/header/error", color: "orange" },
				title: translate("popupConfirmUpdateErrorTitle"),
				text: U.String.sprintf(
					translate("popupConfirmUpdateErrorText"),
					J.Error[err] || err,
				),
				textConfirm: translate("commonRetry"),
				textCancel: translate("commonLater"),
				onConfirm: () => {
					Renderer.send("updateDownload");
				},
				onCancel: () => {
					Renderer.send("updateCancel");
				},
			},
		});

		analytics.event("UpgradeVersionError", {
			type: isDownloading ? "Download" : "CheckFailed",
		});
	};

	const onUpdateProgress = (e: any, progress: any) => {
		S.Progress.update({
			id: I.ProgressType.Update,
			type: I.ProgressType.Update,
			current: progress.transferred,
			total: progress.total,
		});
	};

	const onRoute = (route: string) => {
		if (keyboard.isMain()) {
			U.Router.go(route, {});
		} else {
			S.Common.redirectSet(route);
		}
	};

	/**
	 * The approval window has no session of its own, so main relays the user's Allow/Deny here:
	 * only a full-scope session may answer a pairing request. The code comes back to this session
	 * alone and is handed to main, which shows it in the window.
	 */
	const onLinkApprovalDecision = (e: any, param: any) => {
		const { processPath, origin, allow, grant } = param || {};

		C.AccountLocalLinkApproveChallenge(
			processPath,
			origin,
			allow,
			grant,
			(message: any) => {
				Renderer.send("linkApprovalResult", {
					processPath,
					origin,
					challenge: message.challenge || "",
					error: message.error && message.error.code ? message.error : null,
				});
			},
		);
	};

	const onSpellcheck = (
		e: any,
		misspelledWord: string,
		dictionarySuggestions: string[],
		x: number,
		y: number,
		rect: any,
	) => {
		U.Menu.spellcheck(misspelledWord, dictionarySuggestions, x, y, rect);
	};

	useEffect(() => {
		init();
		const disposeApprovalSpaces = reaction(
			() =>
				approvalSpaces(
					U.Menu.getVaultItems(),
					S.Auth.account?.info?.techSpaceId || "",
				),
			(spaces) => Renderer.send("linkApprovalSpaces", { spaces }),
			{ equals: comparer.structural },
		);

		return () => {
			disposeApprovalSpaces();
			unregisterIpcEvents();
		};
	}, []);

	// Mark the real Electron shell on <html> so the macOS shell chrome in legacy.css
	// (window drag regions and traffic-light clearance) applies; the web build never gets
	// the marker. Uses an attribute, not a class, because keyboard.setBodyClass() rewrites
	// html.className wholesale.
	useEffect(() => {
		if (desktop.isShell()) {
			document.documentElement.setAttribute("data-harness-desktop", "");
			// The served document is the web build (`dist/index.web.html`), whose <title> still says
			// "Anytype Web". The shell is not the web app, so it re-titles its own window.
			document.title = "Anytype Harness";
		}
	}, []);

	const sidebarLeftRef = useCallback(
		(ref) => S.Common.refSet("sidebarLeft", ref),
		[],
	);

	return (
		<Router history={history}>
			<div id="appContainer" ref={nodeRef}>
				{isLoading ? (
					<div id="root-loader" className="loaderWrapper">
						<div className="inner">
							<div className="logo anim from" />
							<div className="version anim from">{electron.version.app}</div>
						</div>

						<RecoveryStatus
							delay={J.Constant.delay.recoveryStatus}
							withLogo={true}
							onCancel={
								isSelectDone ? undefined : () => cancelSelectRef.current?.()
							}
						/>
					</div>
				) : (
					""
				)}

				<div id="dragPanel" />
				<div id="tooltipContainer" />

				<PreviewIndex />
				<Toast />
				<ListNotification key="listNotification" />

				<SelectionProvider
					ref={(ref) => S.Common.refSet("selectionProvider", ref)}
				>
					<DragProvider ref={(ref) => S.Common.refSet("dragProvider", ref)}>
						<SidebarLeft ref={sidebarLeftRef} />
						<UpdateBanner />
						<ListPopup />
						<ListMenu />

						<Switch>
							{J.Route.map((path: string, i: number) => (
								<Route path={path} exact={true} key={i} component={RoutePage} />
							))}
						</Switch>
					</DragProvider>
				</SelectionProvider>
			</div>
		</Router>
	);
};

export default App;
