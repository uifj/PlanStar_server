/**
 * The address the client boots against. The gRPC-web proxy this used to default to is
 * retired: every call rides the Hono command shim under the API base, so the fallback is
 * that base rather than a dead port. Precedence stays url param -> stored value -> here.
 */

const retiredProxyAddress = "http://127.0.0.1:31008";

/**
 * A previously stored address survives only if it is not the retired proxy: the entry point
 * writes whatever it resolved back to localStorage, so without this the dead address would
 * outrank the API base on every later boot.
 */
export const usableStoredAddress = (value: string): string => {
	const stored = String(value || "");

	if (!stored.startsWith("http") || stored === retiredProxyAddress) {
		return "";
	}

	return stored;
};

export const serverAddress = (): string => {
	const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;

	if (configured) {
		return configured.replace(/\/+$/, "");
	}

	const origin = typeof window !== "undefined" ? window.location?.origin : "";
	return `${origin || "http://localhost"}/api`;
};
