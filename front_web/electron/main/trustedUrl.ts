import { DESKTOP_ORIGIN } from "./desktop";

/**
 * Trust decisions for the shell's renderer.
 *
 * Both helpers compare `URL.origin`, never a string prefix: `http://localhost:8321@evil.com`
 * starts with the desktop origin as text, but its origin is `http://evil.com`. The old
 * `url.startsWith(DESKTOP_ORIGIN)` guard let that URL through.
 */

/** True when a navigation target belongs to the shell's own renderer. */
export function isTrustedNavigation(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.origin === DESKTOP_ORIGIN) {
			return true;
		}
		// The waiting page is a `data:` document the shell loads itself while the backend is down.
		return (
			parsed.protocol === "data:" && parsed.pathname.startsWith("text/html")
		);
	} catch {
		return false;
	}
}

/** True when an IPC message came from the shell's own renderer frame (not an iframe/other origin). */
export function isTrustedSenderUrl(url: string | undefined | null): boolean {
	if (!url) {
		return false;
	}
	try {
		return new URL(url).origin === DESKTOP_ORIGIN;
	} catch {
		return false;
	}
}
