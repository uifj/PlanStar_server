import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The mock is a singleton built at import time, and its constructor reads the persisted config, so
// every case resets the module registry and re-imports after the storage stub is in place.
const freshMock = async () => {
	vi.resetModules();
	const { default: electronMock } = await import("./electronMock");
	return electronMock as any;
};

const memoryStore = () => {
	const values = new Map<string, string>();

	return {
		getItem: (key: string) => (values.has(key) ? (values.get(key) as string) : null),
		setItem: (key: string, value: string) => {
			values.set(key, String(value));
		},
		removeItem: (key: string) => {
			values.delete(key);
		},
	};
};

const storedConfig = () => JSON.parse(localStorage.getItem("anytype_config") || "{}");

describe("electronMock config channels", () => {
	let reload: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.stubGlobal("localStorage", memoryStore());
		reload = vi.fn();
		(window as any).location = { reload, href: "http://localhost:3030/" };
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	// Action.setInterfaceLang sends a bare id, not a partial config: spreading that string into the
	// config object writes {"0":"d","1":"e",...} and leaves interfaceLang at its old value, which is
	// how the language picker changed nothing.
	it("stores the interface language as a field, not as spread characters", async () => {
		const mock = await freshMock();

		await mock.Api(1, "setInterfaceLang", ["de-DE"]);

		expect(storedConfig().interfaceLang).toBe("de-DE");
		expect(Object.keys(storedConfig())).not.toContain("0");
	});

	// The desktop's main process restarts the app after a language change because menus, tooltips and
	// shortcuts are built from translate() while booting; a reload is the web equivalent.
	it("reloads when the language actually changes, and not when it does not", async () => {
		const mock = await freshMock();

		await mock.Api(1, "setInterfaceLang", ["fr-FR"]);
		expect(reload).toHaveBeenCalledTimes(1);

		await mock.Api(1, "setInterfaceLang", ["fr-FR"]);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("publishes the stored language to the next boot", async () => {
		const mock = await freshMock();
		await mock.Api(1, "setInterfaceLang", ["it-IT"]);

		expect((await freshMock()).getConfig().interfaceLang).toBe("it-IT");
	});

	it("writes the user data path raw, the way getDataPath reads it", async () => {
		const mock = await freshMock();

		await mock.Api(1, "setUserDataPath", ["/tmp/anytype-data"]);

		expect(localStorage.getItem("anytype_dataPath")).toBe("/tmp/anytype-data");
	});
});
