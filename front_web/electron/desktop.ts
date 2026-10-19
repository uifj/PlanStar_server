import path from 'node:path';

/**
 * The desktop shell's one design decision that shapes everything else: the renderer is served over a
 * loopback *http* origin, not `file://`. Upstream anytype-ts loads `dist/tabs.html` from `file://`
 * (electron/ts/window.ts:965), which is an opaque origin — the httpOnly Better Auth session cookie
 * issued by the API on localhost:8000 would never ride along, and every command would answer 401.
 * Ports do not affect same-site, so `http://localhost:8321` and `http://localhost:8000` are same-site:
 * the cookie is sent, and the request is still cross-*origin*, which the backend allows through the
 * CORS whitelist once this origin is listed there (src/config/constants.ts).
 */

const host = 'localhost';

// Fixed, not ephemeral: the backend trusts this exact origin, so a random port would silently break
// the session cookie. A busy port is reported instead of worked around.
const port = Number(process.env.HARNESS_DESKTOP_PORT || 8321);

export const DESKTOP_ORIGIN = `http://${host}:${port}`;
export const DESKTOP_PORT = port;

// Deep links arrive as anytype-harness://<route>, e.g.
// anytype-harness://main/edit/<rootId>/spaceId/<spaceId>
export const PROTOCOL_SCHEME = 'anytype-harness';

// Where the shell looks for the self-hosted server before it opens the app.
export const apiUrl = (): string =>
	(process.env.HARNESS_API_URL || 'http://localhost:8000').replace(/\/+$/, '');

export const healthUrl = (): string => `${apiUrl()}/api/health`;

// Packaged: electron-builder copies the built renderer into Contents/Resources/renderer.
// Unpackaged (`pnpm dev:electron`): the same dist-web the web target already produces.
export const rendererRoot = (packed: boolean): string =>
	packed
		? path.join(process.resourcesPath, 'renderer')
		: path.resolve(__dirname, '..', 'dist-web');
