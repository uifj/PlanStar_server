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
