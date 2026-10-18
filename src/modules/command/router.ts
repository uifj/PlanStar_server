import { getCurrentUser } from "../../auth/current-user.js";
import { createProtectedRouter } from "../../auth/protected-router.js";
import { auth } from "../../lib/auth.js";
import { commandRoute } from "./routes.js";
import { commandService } from "./service.js";

export const commandRouter = createProtectedRouter();

commandRouter.openapi(commandRoute, async (c) => {
	const { name } = c.req.valid("param");
	const body = c.req.valid("json") ?? {};
	const user = getCurrentUser(c);

	// AccountStop is the live web logout: the shell's S.Auth.logout fires it (via
	// the 'web-session' placeholder token), and nothing else in that flow revokes
	// the Better Auth session cookie. Revocation lives here at the transport
	// boundary because it needs the request's session cookie — the stateless
	// commandService.run() never sees the headers.
	if (name === "AccountStop") {
		const signOutResponse = await auth.api.signOut({
			headers: c.req.raw.headers,
			asResponse: true,
		});
		for (const cookie of signOutResponse.headers.getSetCookie()) {
			c.header("Set-Cookie", cookie, { append: true });
		}
		return c.json({ error: { code: 0, description: "" }, event: null }, 200);
	}

	const payload = await commandService.run(user, name, body);

	return c.json(payload, 200);
});
