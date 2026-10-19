/**
 * The route the address bar asked this boot to open.
 *
 * The app's own routes carry their parameters in the query string — `/main/object/?id=…&spaceId=…`,
 * built by `U.Router.build` — so a link is only whole when the search travels with the path. Truncating
 * to the pathname reaches that page with `id` undefined, and the page then redirects to the space
 * dashboard, which is what a reloaded or shared object link used to do here.
 *
 * The two boot-config params are the exception: the entry point consumes them and strips them from the
 * address bar, so they are dropped from the route rather than stored into it, where every later boot
 * would reconfigure the transport from an old link.
 */

const CONFIG_PARAMS = ["server", "dataPath"];

export interface PageLocation {
	pathname: string;
	search: string;
}

export const stripConfigParams = (search: string): string => {
	const kept = new URLSearchParams(search);
	for (const param of CONFIG_PARAMS) {
		kept.delete(param);
	}
	const value = kept.toString();

	return value ? `?${value}` : "";
};

export const sharedRoute = (location: PageLocation): string => {
	if (!location?.pathname?.startsWith("/main/")) {
		return "";
	}

	return `${location.pathname}${stripConfigParams(location.search || "")}`;
};

/**
 * Owned by this module, and deliberately not `anytype_redirect`: that is the key `Storage` maps
 * `redirect` onto, so the store reads and clears it during a boot the visitor never finished.
 */
const RETURN_KEY = "anytype_authReturn";

/**
 * Remember what the address bar asked for, so it survives the sign-in that auth puts in the way.
 * The gate rewrites the URL to `/auth/better-login`, which erases the requested route from the only
 * place the boot could still read it.
 */
export const rememberRoute = (location: PageLocation): void => {
	const route = sharedRoute(location);

	if (route) {
		localStorage.setItem(RETURN_KEY, JSON.stringify(route));
	}
};

/**
 * The remembered route, consumed. Reading it clears it: a link the visitor never signed in for must
 * not reopen on some later launch. The `/main/` prefix is re-checked rather than trusted, because the
 * stored value comes from browser storage and is handed straight to `location.href`.
 */
export const takeRememberedRoute = (): string => {
	const raw = localStorage.getItem(RETURN_KEY) || "";
	localStorage.removeItem(RETURN_KEY);

	if (!raw) {
		return "";
	}

	let route: unknown;
	try {
		route = JSON.parse(raw);
	} catch {
		return "";
	}

	return typeof route === "string" && route.startsWith("/main/") ? route : "";
};
