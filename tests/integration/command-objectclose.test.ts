import { describe, expect, it, vi } from "vitest";
import { signedOut, signInAs } from "./helpers/auth-session.js";
import { post } from "./helpers/request.js";

// ObjectClose is the shell's best-effort teardown notification, fired AFTER the
// client has already cleared its own object/subscription state (action.ts:40-43:
// dbClearRoot, S.Block.clear, U.Subscription.destroyList). The web backend keeps
// no server-side open-object handles — loading a view is a pure read — so there
// is nothing to release and it answers OK unconditionally, mirroring
// ObjectSearchUnsubscribe / ChatUnsubscribe.
vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

describe("POST /api/command/ObjectClose", () => {
	it("acknowledges the teardown of an open object", async () => {
		signInAs("objectclose.user");

		const res = await post("/api/command/ObjectClose", {
			objectId: "some-object",
			spaceId: "some-space",
		});
		const body = await res.json();

		expect(res.status).toEqual(200);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.event).toBeNull();
	});

	it("requires a session", async () => {
		signedOut();

		const res = await post("/api/command/ObjectClose", {
			objectId: "some-object",
			spaceId: "some-space",
		});

		expect(res.status).toEqual(401);
	});
});
