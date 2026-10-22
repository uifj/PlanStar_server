import { electronMock } from "../src/ts/lib/web/electronMock";

/**
 * Storybook runs the renderer in a plain browser, so it needs the same globals that
 * `src/ts/entry.web.tsx` installs before importing the app:
 *
 * - `window.Electron` backs `U.Common.getElectron()`; without it components either throw or render
 *   desktop-only controls.
 * - `window.AnytypeGlobalConfig` carries theme and interface language; `S.Common.config` prefers it
 *   over the store copy.
 * - `window.isWebVersion` hides shell-only affordances (clipboard writes, tray actions).
 *
 * This module must stay the first import in `preview.ts`: Storybook evaluates preview dependencies
 * before it imports any story, so the globals are in place when component modules run.
 */
const storybookWindow = window as unknown as {
	Electron?: typeof electronMock;
	AnytypeGlobalConfig?: Record<string, unknown>;
	isWebVersion?: boolean;
};

storybookWindow.Electron = electronMock;
storybookWindow.AnytypeGlobalConfig = { ...electronMock.getConfig() };
storybookWindow.isWebVersion = true;
