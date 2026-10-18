/**
 * The address the client boots against. The gRPC-web proxy this used to default to is
 * retired: every call rides the Hono command shim under the API base, so the fallback is
 * that base rather than a dead port. Precedence stays url param -> stored value -> here.
 */

export const serverAddress = (): string => {
	const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;

	if (configured) {
		return configured.replace(/\/+$/, "");
	}

	const origin = typeof window !== "undefined" ? window.location?.origin : "";
	return `${origin || "http://localhost"}/api`;
};
