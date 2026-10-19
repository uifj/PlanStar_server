import { app, BrowserWindow, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import {
	DESKTOP_ORIGIN,
	DESKTOP_PORT,
	PROTOCOL_SCHEME,
	apiUrl,
	healthUrl,
	rendererRoot,
} from './desktop';
import { createRendererServer, listen } from './server';
import { runSmoke } from './smoke';

type WindowState = {
	x?: number;
	y?: number;
	width: number;
	height: number;
	maximized: boolean;
};

const DEFAULT_STATE: WindowState = { width: 1280, height: 840, maximized: false };
const PRELOAD = path.join(__dirname, 'preload.cjs');

// The last non-maximized frame, so closing while maximized does not persist the zoomed bounds.
let lastRestored: { x?: number; y?: number; width: number; height: number } | null = null;

const stateFile = (): string => path.join(app.getPath('userData'), 'window.json');

const readState = (): WindowState => {
	try {
		return { ...DEFAULT_STATE, ...(JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Partial<WindowState>) };
	} catch {
		return { ...DEFAULT_STATE };
	}
};

const saveState = (win: BrowserWindow): void => {
	if (win.isDestroyed()) {
		return;
	}
	const maximized = win.isMaximized();
	// While maximized, getBounds() reports the zoomed frame; keep the restored size from that.
	const bounds = maximized ? (lastRestored ?? win.getBounds()) : win.getBounds();
	lastRestored = bounds;
	try {
		fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
		fs.writeFileSync(
			stateFile(),
			JSON.stringify({ ...bounds, maximized } satisfies WindowState),
		);
	} catch {
		// A unreadable userData dir must not stop the app from closing.
	}
};

const waitingHtml = (): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Harness server needed</title>
<style>
 body { font: 14px/1.6 -apple-system, system-ui, sans-serif; margin: 0; min-height: 100vh;
   display: grid; place-items: center; background: #f4f4f4; color: #111;
   -webkit-app-region: drag; }
 main { max-width: 34rem; padding: 2rem; background: #fff; border-radius: 12px;
   box-shadow: 0 1px 3px rgba(0,0,0,.12); -webkit-app-region: no-drag; }
 h1 { font-size: 1.1rem; margin: 0 0 .6rem; }
 code { background: #f0f0f0; padding: .15rem .4rem; border-radius: 4px; }
 p { margin: .5rem 0; }
 .dot { display:inline-block; width:.5rem; height:.5rem; border-radius:50%; background:#e0a100; margin-right:.4rem; }
</style></head>
<body><main>
 <h1><span class="dot"></span>Waiting for the local harness server</h1>
 <p>This desktop app is a shell around your own backend. It is looking for the API at
 <code>${apiUrl()}</code> and will connect as soon as it answers.</p>
 <p>Start it from the repository root:</p>
 <p><code>podman start vanlife-postgres</code> then <code>pnpm dev</code></p>
 <p>Nothing is sent anywhere else — commands go only to that origin.</p>
</main></body></html>`;

// A route handed to the shell before the document is ready would be dropped by the history API, so
// it is parked until the first load settles.
const pendingRoutes: string[] = [];

const sendRoute = (win: BrowserWindow, route: string): void => {
	const deliver = (): void => {
		if (!win.isDestroyed()) {
			win.webContents.send('desktop:route', route);
		}
	};
	if (win.webContents.isLoading()) {
		win.webContents.once('did-finish-load', deliver);
		return;
	}
	deliver();
};

// anytype-harness://main/edit/<id>/spaceId/<space> -> /main/edit/<id>/spaceId/<space>
const routeFromUrl = (raw: string): string | null => {
	if (!raw.startsWith(`${PROTOCOL_SCHEME}://`)) {
		return null;
	}
	try {
		const url = new URL(raw);
		const host = url.host ? `/${url.host}` : '';
		const route = `${host}${url.pathname}${url.search}`.replace(/\/$/, '') || '/';
		return route.startsWith('/main/') || route.startsWith('/auth/') || route === '/' ? route : null;
	} catch {
		return null;
	}
};

const routeFromArgv = (argv: string[]): string | null =>
	argv.map(routeFromUrl).find((route): route is string => !!route) ?? null;

const healthy = async (): Promise<boolean> => {
	try {
		const response = await fetch(healthUrl(), { signal: AbortSignal.timeout(2000) });
		return response.ok;
	} catch {
		return false;
	}
};

let mainWindow: BrowserWindow | null = null;

const createWindow = (): BrowserWindow => {
	const state = readState();
	lastRestored = { x: state.x, y: state.y, width: state.width, height: state.height };

	const win = new BrowserWindow({
		x: state.x,
		y: state.y,
		width: state.width,
		height: state.height,
		minWidth: 900,
		minHeight: 600,
		show: false,
		title: 'Anytype Harness',
		backgroundColor: '#ffffff',
		// The ported stylesheet already carries -webkit-app-region rules, which only mean something
		// under an inset title bar.
		titleBarStyle: 'hiddenInset',
		trafficLightPosition: { x: 16, y: 16 },
		webPreferences: {
			preload: PRELOAD,
			contextIsolation: true,
			nodeIntegration: false,
			spellcheck: true,
		},
	});

	win.once('ready-to-show', () => {
		win.show();
		if (state.maximized) {
			win.maximize();
		}
	});

	const trackFrame = (): void => {
		if (!win.isDestroyed() && !win.isMaximized()) {
			lastRestored = win.getBounds();
		}
	};
	win.on('resize', trackFrame);
	win.on('move', trackFrame);
	win.on('close', () => saveState(win));

	// External destinations leave the shell; anything else stays inside it.
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//.test(url) && !url.startsWith(DESKTOP_ORIGIN)) {
			shell.openExternal(url).catch(() => undefined);
		}
		return { action: 'deny' };
	});
	win.webContents.on('will-navigate', (event, url) => {
		if (!url.startsWith(DESKTOP_ORIGIN) && !url.startsWith('data:')) {
			event.preventDefault();
		}
	});

	return win;
};

const loadApp = async (win: BrowserWindow): Promise<void> => {
	if (await healthy()) {
		await win.loadURL(DESKTOP_ORIGIN);
		return;
	}
	await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(waitingHtml()));

	// Poll rather than give up: the backend is usually a `pnpm dev` away.
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

const buildMenu = (win: BrowserWindow): void => {
	const template: Electron.MenuItemConstructorOptions[] = [
		{ role: 'appMenu' },
		{ role: 'fileMenu' },
		{ role: 'editMenu' },
		{
			label: 'View',
			submenu: [
				{ role: 'reload' },
				{ role: 'forceReload' },
				{ role: 'toggleDevTools' },
				{ type: 'separator' },
				{ role: 'resetZoom' },
				{ role: 'zoomIn' },
				{ role: 'zoomOut' },
				{ type: 'separator' },
				{ role: 'togglefullscreen' },
			],
		},
		{ role: 'windowMenu' },
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));

	// The shell owns the window, so the deep-link queue needs a live target.
	win.webContents.on('did-finish-load', () => {
		while (pendingRoutes.length) {
			const route = pendingRoutes.shift();
			if (route) {
				sendRoute(win, route);
			}
		}
	});
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

const boot = async (): Promise<void> => {
	if (!app.setAsDefaultProtocolClient(PROTOCOL_SCHEME)) {
		console.warn(`[desktop] could not register the ${PROTOCOL_SCHEME}:// handler`);
	}

	const root = rendererRoot(app.isPackaged);
	if (!fs.existsSync(path.join(root, 'index.html'))) {
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
			code === 'EADDRINUSE'
				? `Port ${DESKTOP_PORT} is busy, and the desktop origin http://localhost:${DESKTOP_PORT} is fixed — the backend only trusts that one. Free the port, or start the shell with HARNESS_DESKTOP_PORT and add the matching origin to the server's TRUSTED_ORIGINS.`
				: `The desktop shell could not start its local server: ${String(error)}`,
		);
		app.quit();
		return;
	}

	mainWindow = createWindow();
	buildMenu(mainWindow);
	await loadApp(mainWindow);
	openRoute(routeFromArgv(process.argv));

	if (process.env.HARNESS_DESKTOP_SMOKE) {
		const ok = await runSmoke(mainWindow);
		app.exit(ok ? 0 : 1);
	}
};

const dialogError = async (message: string): Promise<void> => {
	const { dialog } = await import('electron');
	await dialog.showErrorBox('Anytype Harness', message);
};

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', (_event, argv) => openRoute(routeFromArgv(argv)));

	app.on('open-url', (event, url) => {
		event.preventDefault();
		openRoute(routeFromUrl(url));
	});

	app.on('web-contents-created', (_event, contents) => {
		// A rendered link must never take the shell off its own origin.
		contents.on('will-navigate', (e, url) => {
			if (!url.startsWith(DESKTOP_ORIGIN) && !url.startsWith('data:')) {
				e.preventDefault();
			}
		});
	});

	app.whenReady().then(boot).catch(async (error) => {
		await dialogError(String(error));
		app.quit();
	});

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			const win = createWindow();
			buildMenu(win);
			void loadApp(win);
		}
	});

	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') {
			app.quit();
		}
	});
}
