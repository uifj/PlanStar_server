import type { Session } from "better-auth";
import type { SessionUser } from "../../../src/lib/auth.js";

export const user: SessionUser = {
	id: "user-1",
	name: "John Doe",
	email: "john@example.com",
	emailVerified: true,
	image: null,
	createdAt: new Date("2026-01-01"),
	updatedAt: new Date("2026-01-01"),
	banned: false,
	role: null,
};

export const session: Session = {
	id: "session-1",
	userId: user.id,
	token: "session-token",
	expiresAt: new Date("2099-01-01"),
	createdAt: new Date("2026-01-01"),
	updatedAt: new Date("2026-01-01"),
	ipAddress: null,
	userAgent: null,
};
