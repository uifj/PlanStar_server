import { beforeEach, describe, expect, it, vi } from "vitest";

import { serverAddress, usableStoredAddress } from "./serverAddress";

describe("serverAddress", () => {
	it("uses the configured API base, without its trailing slash", () => {
		vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000/api/");

		expect(serverAddress()).toBe("http://localhost:8000/api");

		vi.unstubAllEnvs();
	});

	it("falls back to a same-origin API base, never the retired proxy port", () => {
		vi.stubEnv("VITE_API_BASE_URL", "");

		const value = serverAddress();

		expect(value).not.toContain("31008");
		expect(value).toMatch(/^https?:\/\/.+/);

		vi.unstubAllEnvs();
	});

	// The web build advertises `?server=http://HOST:PORT` as its configuration interface, and the
	// transport now asks this helper, so the override moves the commands instead of only the boot log.
	it("prefers the ?server= param over a stored or configured address", () => {
		vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000/api");
		browser("?server=http://10.0.0.9:8000/api", "http://localhost:8000/api");

		expect(serverAddress()).toBe("http://10.0.0.9:8000/api");

		vi.unstubAllEnvs();
	});

	// The boot hint advertises `?server=http://HOST:PORT`, but every interface the client calls is
	// under the API base (`/api/command/*`, `/api/events`, `/api/publish`). An origin-only override
	// must still reach those, not `/command/*`, which the backend 404s without CORS headers.
	it("adds the API base to the advertised origin-only ?server= form", () => {
		vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000/api");
		browser("?server=http://10.0.0.9:8000", "http://localhost:8000/api");

		expect(serverAddress()).toBe("http://10.0.0.9:8000/api");

		vi.unstubAllEnvs();
	});

	it("keeps an explicit API path in the ?server= form", () => {
		vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000/api");
		browser(
			"?server=http://10.0.0.9:8000/gateway/api/",
			"http://localhost:8000/api",
		);

		expect(serverAddress()).toBe("http://10.0.0.9:8000/gateway/api");

		vi.unstubAllEnvs();
	});

	it("keeps the address a previous boot resolved", () => {
		vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000/api");
		browser("", "http://10.0.0.9:8000/api");

		expect(serverAddress()).toBe("http://10.0.0.9:8000/api");

		vi.unstubAllEnvs();
	});

	it("ignores a stored address that points at the retired proxy", () => {
		vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000/api");
		browser("", "http://127.0.0.1:31008");

		expect(serverAddress()).toBe("http://localhost:8000/api");

		vi.unstubAllEnvs();
	});
});

const browser = (search: string, stored: string | null) => {
	vi.stubGlobal("window", {
		location: { search, origin: "http://localhost:3030" },
	});
	vi.stubGlobal("localStorage", {
		getItem: () => stored,
		setItem: () => undefined,
	});
};

beforeEach(() => {
	vi.unstubAllGlobals();
});

describe("usableStoredAddress", () => {
	it("discards a stored address that points at the retired proxy", () => {
		expect(usableStoredAddress("http://127.0.0.1:31008")).toBe("");
	});

	it("keeps a stored API base and drops a non-address", () => {
		expect(usableStoredAddress("http://localhost:8000/api")).toBe(
			"http://localhost:8000/api",
		);
		expect(usableStoredAddress("")).toBe("");
		expect(usableStoredAddress("not-a-url")).toBe("");
	});
});
