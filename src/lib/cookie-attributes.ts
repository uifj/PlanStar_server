/**
 * Session-cookie policy for a deployment, derived from `APP_URL` alone.
 *
 * The web renderer is served from the same origin as the API, so the browser default
 * (`SameSite=Lax`) works there. The desktop shell is *not* same-origin: it serves its renderer
 * from `http://localhost:8321` and calls `https://api.<domain>`, and a `Lax` cookie is withheld
 * from cross-site `fetch(..., { credentials: "include" })` entirely — every authenticated call
 * 401s. `SameSite=None` is the only attribute pair a browser accepts for that traffic, and it
 * *requires* `Secure`, which in turn requires an https deployment.
 *
 * Keeping this in one pure function means the security decision is unit-testable and there is
 * exactly one place that can widen the policy.
 *
 * @see docs/adr/0026-cloud-cookie-policy.md
 */

/** The subset of `Set-Cookie` attributes Better Auth lets us pin globally. */
export interface SessionCookieAttributes {
	httpOnly: boolean;
	secure: boolean;
	path: string;
	sameSite: "lax" | "none";
}

/**
 * `https:` → `SameSite=None; Secure` (the cross-site desktop path). Anything else (plain http,
 * a loopback URL, an unparseable value) stays on the safer `Lax` default, because browsers drop
 * `SameSite=None` cookies that are not `Secure` — sending it would silently break sessions
 * instead of failing loudly.
 */
export function resolveCookieAttributes(
	appUrl: string,
): SessionCookieAttributes {
	// A trailing slash or path component does not change the scheme, and `URL` rejects a missing
	// scheme, which is exactly the case we want to fall back on.
	const secure = isHttpsUrl(appUrl);
	return {
		httpOnly: true,
		path: "/",
		secure,
		sameSite: secure ? "none" : "lax",
	};
}

/** Whether `appUrl` is an https origin (the gate for the cross-site cookie policy). */
export function isHttpsUrl(appUrl: string): boolean {
	try {
		return new URL(appUrl).protocol === "https:";
	} catch {
		return false;
	}
}
