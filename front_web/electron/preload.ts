import { installDesktopBridge } from "./preload/bridge";

/**
 * Preload entry.
 *
 * The bridge lives in `preload/bridge.ts` so tests can import the facade object without touching
 * `contextBridge`. This file is a one-liner on purpose: if it ever grows, the logic belongs in
 * the bridge module, not here.
 *
 * Backward compatibility: the old `window.Desktop` shape (`isDesktop`, `platform`,
 * `electronVersion`, `chromeVersion`) is preserved verbatim inside the bridge, and the
 * `desktop:route` push still drives `window.history.pushState` exactly as before — the renderer's
 * `lib/web/routeSync.ts` needs no changes.
 */
installDesktopBridge();
