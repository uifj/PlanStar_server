import type { AuthUser } from "../lib/auth.js";

export const ROLES = {
	ADMIN: "admin",
	HOST: "host",
	USER: "user",
} as const;

export function getRoles(user: AuthUser): string[] {
	return (
		user.role
			?.split(",")
			.map((role) => role.trim())
			.filter(Boolean) ?? []
	);
}

function hasRole(user: AuthUser, role: string): boolean {
	return getRoles(user).includes(role);
}

export function isAdmin(user: AuthUser): boolean {
	return hasRole(user, ROLES.ADMIN);
}

export function isHost(user: AuthUser): boolean {
	return hasRole(user, ROLES.HOST);
}

export function isUser(user: AuthUser): boolean {
	return hasRole(user, ROLES.USER);
}
