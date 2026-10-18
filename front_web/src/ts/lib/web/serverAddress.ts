/**
 * The address the client boots against — the one base the command shim, the SSE event channel, the
 * space bootstrap and the publish links all resolve through. The gRPC-web proxy this used to default
 * to is retired: every call rides the Hono backend under the API base.
 *
 * Precedence is what the entry point documents and the boot log shows: the `?server=` url param, then
 * the address a previous boot resolved, then the configured or same-origin API base. Resolving it
 * here rather than only in entry.web is what makes the override reach the transport: entry.web reads
 * and stores the value before it strips the params off the address bar, so a later call still lands
 * on the same base.
 */

const retiredProxyAddress = "http://127.0.0.1:31008";

/**
 * A previously stored address survives only if it is not the retired proxy: the entry point writes
 * whatever it resolved back to localStorage, so without this the dead address would outrank the API
 * base on every later boot.
 */
export const usableStoredAddress = (value: string): string => {
	const stored = String(value || "");

	if (!stored.startsWith("http") || stored === retiredProxyAddress) {
		return "";
	}

	return stored;
};

// The configured base, or this page's own origin when the build names no server.
const fallbackAddress = (): string => {
	const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;

	if (configured) {
		return configured.replace(/\/+$/, "");
	}

	const origin = typeof window !== "undefined" ? window.location?.origin : "";
	return `${origin || "http://localhost"}/api`;
};

export const serverAddress = (): string => {
	if (typeof window === "undefined" || typeof localStorage === "undefined") {
		return fallbackAddress();
	}

	const requested = new URLSearchParams(window.location?.search || "").get("server") || "";
	const stored = usableStoredAddress(localStorage.getItem("anytype_serverAddress") || "");

	return requested || stored || fallbackAddress();
};
