import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// The rig runs without vitest globals, so testing-library's automatic cleanup never
// registers and a mounted tree would leak into the next test.
afterEach(() => cleanup());

// jsdom has no matchMedia, and a component that mounts the theme provider reads it
// for the system colour scheme.
beforeEach(() => {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {},
		}),
	});
});
