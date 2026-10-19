import { describe, expect, it } from "vitest";

import { sharedRoute, stripConfigParams } from "./deepLink";

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
