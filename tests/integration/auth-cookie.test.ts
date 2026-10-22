import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { afterAll, describe, expect, it } from "vitest";
import app from "../../src/app.js";
import { API_PREFIX } from "../../src/config/constants.js";
import { env } from "../../src/config/env.js";
import { createAuthOptions } from "../../src/lib/auth.js";
import { resolveCookieAttributes } from "../../src/lib/cookie-attributes.js";
import { prisma } from "../../src/lib/prisma.js";

/**
 * The session cookie is the one piece of state the desktop shell cannot work around: its renderer
 * is served from `http://localhost:8321` while the API lives on another origin, so a `SameSite=Lax`
 * cookie is never sent and every authenticated call 401s. These cases pin the attribute pair that
 * actually ships for each deployment shape, against a real Better Auth handler and a real database
 * (integration suite), not against the option object.
 *
 * @see docs/adr/0026-cloud-cookie-policy.md
 */

const createdEmails: string[] = [];

const credentials = () => {
	const email = `cookie-${randomUUID()}@harness.test`;
	createdEmails.push(email);
	return { email, password: "desktop-shell-e2e", name: "Cookie Probe" };
};

const setCookies = (response: Response): string[] => {
	const fromNode = (
		response.headers as Headers & { getSetCookie?: () => string[] }
	).getSetCookie?.();
	if (fromNode && fromNode.length > 0) {
		return fromNode;
	}
	const joined = response.headers.get("set-cookie");
	return joined ? [joined] : [];
};

const sessionCookie = (cookies: string[]): string => {
	const found = cookies.find((value) =>
		value.toLowerCase().includes("session_token"),
	);
	if (!found) {
		throw new Error(`no session cookie in ${JSON.stringify(cookies)}`);
	}
	return found;
};

afterAll(async () => {
	await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
});

describe("session cookie policy", () => {
	it("serves SameSite=Lax over plain http (local/VPS-http deployments)", async () => {
		// `.env.test` points APP_URL at http://localhost:9999, exactly like a local run.
		const response = await app.request(`${API_PREFIX}/auth/sign-up/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(credentials()),
		});

		expect(response.status).toBe(200);
		const cookie = sessionCookie(setCookies(response));
		expect(cookie).toMatch(/;\s*SameSite=Lax(;|$)/i);
		expect(cookie).toMatch(/;\s*HttpOnly(;|$)/i);
		expect(cookie).toMatch(/;\s*Path=\/(;|$)/i);
		// A `Secure` cookie would be dropped by the browser over http, so the attribute must be absent.
		expect(cookie).not.toMatch(/;\s*Secure(;|$)/i);
	});

	it("serves SameSite=None; Secure when APP_URL is https (the cross-site desktop path)", async () => {
		// Built from the same options factory the server boots with, only the deployment URL
		// differs. `useSecureCookies` also flips the `__Secure-` name prefix, which browsers
		// require to match the attribute.
		const httpsAuth = betterAuth(
			createAuthOptions({
				appUrl: "https://api.harness.test",
				secret: env.BETTER_AUTH_SECRET,
			}),
		);

		const response = await httpsAuth.handler(
			new Request("https://api.harness.test/api/auth/sign-up/email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(credentials()),
			}),
		);

		expect(response.status).toBe(200);
		const cookie = sessionCookie(setCookies(response));
		expect(cookie).toContain("__Secure-");
		expect(cookie).toMatch(/;\s*SameSite=None(;|$)/i);
		expect(cookie).toMatch(/;\s*Secure(;|$)/i);
		expect(cookie).toMatch(/;\s*HttpOnly(;|$)/i);
	});

	it("keeps the policy a pure function of APP_URL", () => {
		expect(resolveCookieAttributes("https://api.harness.test")).toEqual({
			httpOnly: true,
			path: "/",
			secure: true,
			sameSite: "none",
		});
		expect(resolveCookieAttributes("http://localhost:8321")).toEqual({
			httpOnly: true,
			path: "/",
			secure: false,
			sameSite: "lax",
		});
	});
});
