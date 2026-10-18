import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { auth } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/prisma.js";
import { signedOut, signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

// AccountStop is the web logout. The Anytype shell fires it from S.Auth.logout
// (header/auth/logout.tsx:9, popup/logout.tsx:66); the lean web boot sets a placeholder token
// (app.tsx:549) so that path is live, and nothing else in the logout flow revokes the Better Auth
// session cookie the command shim authenticates with. So stopping the account must revoke that
// session — otherwise the cookie still authenticates and the logout is only cosmetic. signOut is
// mocked here (the harness stubs the auth module), so the revocation is pinned by the call plus the
// session-clearing Set-Cookie the endpoint must hand back to the browser.
vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn(), signOut: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

describe.skipIf(!databaseAvailable)("POST /api/command/AccountStop", () => {
	const userId = "accountstop.user";
	const clearCookie = "better-auth.session_token=; Path=/; Max-Age=0; HttpOnly";

	beforeAll(async () => {
		await prisma.user.create({
			data: {
				id: userId,
				name: "Account stop user",
				email: "accountstop@vanlife.test",
			},
		});
	});

	afterAll(async () => {
		await prisma.user.deleteMany({ where: { id: userId } });
	});

	it("revokes the caller's Better Auth session and answers OK", async () => {
		signInAs(userId);
		const signOut = vi.mocked(auth.api.signOut);
		signOut.mockResolvedValue(
			new Response(null, {
				headers: { "Set-Cookie": clearCookie },
			}) as never,
		);

		const res = await post("/api/command/AccountStop", { removeData: false });
		const body = await res.json();

		expect(body.error).toEqual({ code: 0, description: "" });
		expect(signOut).toHaveBeenCalledTimes(1);
		expect(res.headers.getSetCookie()).toContain(clearCookie);
	});

	it("requires a session", async () => {
		signedOut();
		const res = await post("/api/command/AccountStop", { removeData: false });
		expect(res.status).toEqual(401);
	});
});
