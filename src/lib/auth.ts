import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin as AdminPlugin, openAPI } from "better-auth/plugins";
import { ac, admin, host, user } from "../auth/permissions.js";
import { TRUSTED_ORIGINS } from "../config/constants.js";
import { env } from "../config/env.js";
import { isHttpsUrl, resolveCookieAttributes } from "./cookie-attributes.js";
import { prisma } from "./prisma.js";

// The desktop shell renders from `http://localhost:8321` and calls this API cross-site, so the
// session cookie has to be `SameSite=None; Secure` on an https deployment. Better Auth defaults
// to `Lax`, which the browser withholds from exactly that traffic — see
// docs/adr/0026-cloud-cookie-policy.md. Pinned here rather than per-route so no future plugin
// can re-narrow it by accident.
//
// Kept as a factory so a test can build the very same configuration against an https `APP_URL`
// (the deployment that matters) without reloading the module graph. Deliberately *excludes*
// `plugins`: `betterAuth` infers the schema extensions (`user.role` from the admin plugin) from the
// plugin tuple, and returning plugins through a helper widens them to `BetterAuthPlugin[]` and
// loses that inference. Production spreads this and adds the plugins inline below.
export function createAuthOptions({
	appUrl,
	secret,
}: {
	appUrl: string;
	secret: string;
}) {
	return {
		baseURL: appUrl,
		secret,
		database: prismaAdapter(prisma, {
			provider: "postgresql" as const,
		}),
		trustedOrigins: TRUSTED_ORIGINS,
		advanced: {
			// Keeps the `__Secure-` cookie-name prefix in step with the attribute below.
			useSecureCookies: isHttpsUrl(appUrl),
			defaultCookieAttributes: resolveCookieAttributes(appUrl),
		},
		emailAndPassword: {
			enabled: true,
		},
	};
}

export const auth = betterAuth({
	...createAuthOptions({
		appUrl: env.APP_URL,
		secret: env.BETTER_AUTH_SECRET,
	}),
	plugins: [
		openAPI(),
		AdminPlugin({
			ac,
			roles: {
				admin,
				host,
				user,
			},
		}),
	],
});

export type SessionUser = typeof auth.$Infer.Session.user;
type SessionData = typeof auth.$Infer.Session.session;

export type AuthType = {
	user: SessionUser | null;
	session: SessionData | null;
};

export type AuthUser = NonNullable<AuthType["user"]>;
