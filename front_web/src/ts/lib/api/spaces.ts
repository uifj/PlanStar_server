// Typed client for the Hono backend's space bootstrap endpoints. The web build
// authenticates with the Better Auth session cookie, so these calls run with
// credentials:"include" against the same /api origin the auth client uses.

export interface Space {
	id: string;
	name: string;
	status: string;
	permission: string;
	createdAt: string;
	updatedAt: string;
}

interface Paginated<T> {
	data: T[];
	meta: { page: number; limit: number; total: number; totalPages: number };
}

export const DEFAULT_SPACE_NAME = "My Space";

const apiBase = (): string => {
	const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
	if (configured) {
		return configured.replace(/\/+$/, "");
	}

	const origin =
		typeof window !== "undefined" ? window.location?.origin : undefined;
	return `${origin ?? "http://localhost"}/api`;
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
	const method = init?.method ?? "GET";
	const response = await fetch(`${apiBase()}${path}`, {
		credentials: "include",
		...init,
	});

	if (!response.ok) {
		throw new Error(`${method} ${path} failed: ${response.status}`);
	}

	return (await response.json()) as T;
};

export const listSpaces = async (): Promise<Space[]> => {
	const page = await request<Paginated<Space>>("/spaces");
	return page.data;
};

export const createSpace = async (name: string): Promise<Space> =>
	request<Space>("/spaces", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});

// Ensures the authenticated account has at least one space, provisioning a
// default on first boot. This is the web replacement for the mnemonic chain
// that used to auto-create the initial space during desktop onboarding.
export const ensureBootstrapSpace = async (): Promise<Space[]> => {
	const existing = await listSpaces();
	if (existing.length > 0) {
		return existing;
	}

	return [await createSpace(DEFAULT_SPACE_NAME)];
};
