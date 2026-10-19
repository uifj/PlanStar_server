import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	rememberRoute,
	sharedRoute,
	stripConfigParams,
	takeRememberedRoute,
} from "./deepLink";

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

// The app's own routes put their parameters in the query string (`/main/object/?id=…&spaceId=…`),
// so a shared or reloaded link is only whole when the search survives with the path. Truncating to
// the pathname lands the object page on an id of `undefined`, which then redirects to the dashboard.
describe("sharedRoute", () => {
	it("keeps the query string of an app route", () => {
		expect(
			sharedRoute({
				pathname: "/main/object/",
				search: "?id=cmvdkx3ab&spaceId=cmvaxybk",
			}),
		).toBe("/main/object/?id=cmvdkx3ab&spaceId=cmvaxybk");
	});

	it("names no route for the landing page and the auth screens", () => {
		expect(sharedRoute({ pathname: "/", search: "" })).toBe("");
		expect(sharedRoute({ pathname: "/auth/select", search: "" })).toBe("");
	});

	it("returns a parameterless app route unchanged", () => {
		expect(sharedRoute({ pathname: "/main/chat/cmvd9oavd", search: "" })).toBe(
			"/main/chat/cmvd9oavd",
		);
	});

	// The boot-config params are consumed by the entry point and must not ride along into the route,
	// or every later boot of that stored redirect would reconfigure the transport.
	it("drops the boot-config params but keeps the route's own", () => {
		expect(
			sharedRoute({
				pathname: "/main/object/",
				search: "?server=http://10.0.0.9:8000/api&id=cmvdkx3ab",
			}),
		).toBe("/main/object/?id=cmvdkx3ab");
	});
});

describe("stripConfigParams", () => {
	it("leaves a search that names no config param alone", () => {
		expect(stripConfigParams("?id=cmvdkx3ab")).toBe("?id=cmvdkx3ab");
		expect(stripConfigParams("")).toBe("");
	});

	it("keeps the separators of what survives", () => {
		expect(
			stripConfigParams("?server=http://10.0.0.9:8000/api&dataPath=/tmp&spaceId=cmvaxybk"),
		).toBe("?spaceId=cmvaxybk");
		expect(stripConfigParams("?server=http://10.0.0.9:8000/api")).toBe("");
	});
});

// The auth gate rewrites the address bar to the sign-in screen, so the requested route has to be
// remembered before that happens and handed back once a session exists.
describe("rememberRoute / takeRememberedRoute", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", memoryStore());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("gives an interrupted app route back exactly once", () => {
		rememberRoute({ pathname: "/main/object/", search: "?id=cmvdkx3ab&spaceId=cmvaxybk" });

		expect(takeRememberedRoute()).toBe("/main/object/?id=cmvdkx3ab&spaceId=cmvaxybk");
		expect(takeRememberedRoute()).toBe("");
	});

	// `anytype_redirect` is the store's own `redirect` slot (Storage maps onto it), so writing there
	// would let a half-finished boot read and clear the visitor's link.
	it("leaves the store's redirect slot alone", () => {
		rememberRoute({ pathname: "/main/chat/cmvd9oavd", search: "" });

		expect(localStorage.getItem("anytype_redirect")).toBe(null);
		expect(localStorage.getItem("anytype_authReturn")).toBe('"/main/chat/cmvd9oavd"');
	});

	it("remembers nothing for the landing page or the auth screens", () => {
		rememberRoute({ pathname: "/auth/better-login", search: "" });
		expect(takeRememberedRoute()).toBe("");

		rememberRoute({ pathname: "/", search: "" });
		expect(takeRememberedRoute()).toBe("");
	});

	// The stored value is browser storage handed straight to `location.href`, so a stale or hand-set
	// entry must not be able to send the app somewhere else.
	it("refuses a stored value that is not an app route", () => {
		for (const stored of ['"//evil.example.test/main"', '"https://evil.example.test"', '"notjson', "42"]) {
			localStorage.setItem("anytype_authReturn", stored);
			expect(takeRememberedRoute()).toBe("");
		}
	});
});
