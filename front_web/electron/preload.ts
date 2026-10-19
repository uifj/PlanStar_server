import { contextBridge, ipcRenderer } from 'electron';

/**
 * The desktop shell's renderer surface. It is deliberately small: the ported client already talks to a
 * `window.Electron` shape through `lib/web/electronMock.ts`, and that mock is what the audited
 * interfaces are built against — replacing it with a native bridge would silently change behaviour the
 * web target depends on. So the shell adds only what a native window can offer and cannot fake:
 * identity, and deep links handed to the app's own route sync.
 */
contextBridge.exposeInMainWorld('Desktop', {
	isDesktop: true,
	platform: process.platform,
	electronVersion: process.versions.electron,
	chromeVersion: process.versions.chrome,
});

// A deep link becomes a history navigation, which `lib/web/routeSync.ts` already handles by reading the
// whole route (query string included) — the same path a browser back/forward takes.
ipcRenderer.on('desktop:route', (_event, route: unknown) => {
	if (typeof route !== 'string' || !route.startsWith('/')) {
		return;
	}
	window.history.pushState({ route }, '', route);
	window.dispatchEvent(new PopStateEvent('popstate', { state: { route } }));
});
