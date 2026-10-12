import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin as AdminPlugin, openAPI } from "better-auth/plugins";
import { ac, admin, host, user } from "../auth/permissions.js";
import { env } from "../config/env.js";
import { prisma } from "./prisma.js";

export const auth = betterAuth({
	baseURL: env.APP_URL,
	secret: env.BETTER_AUTH_SECRET,
	database: prismaAdapter(prisma, {
		provider: "postgresql",
	}),
	trustedOrigins: [env.CLIENT_URL],
	emailAndPassword: {
		enabled: true,
	},
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
