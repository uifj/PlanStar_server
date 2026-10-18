import { createAuthClient } from "better-auth/react";

// Better Auth appends its own basePath (`/api/auth`) to the baseURL, but only
// when the baseURL carries no path. VITE_API_BASE_URL already ends in `/api`,
// so reduce it to the origin and let the client build `/api/auth/*` itself.
const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
const baseURL = configured
	? new URL(configured).origin
	: window.location.origin;

export const authClient = createAuthClient({
	baseURL,
});

export const { signIn, signUp } = authClient;

// The client is created without server-type inference, so Better Auth types the
// session as `never` and overloads the accessors to demand arguments they do not
// take at runtime. Declare the shape the backend actually returns (verified
// against GET /api/auth/get-session) and expose honest zero-arg wrappers.
export interface AuthUser {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image: string | null;
	role: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface AuthSessionRecord {
	id: string;
	userId: string;
	token: string;
	expiresAt: string;
	createdAt: string;
	updatedAt: string;
	ipAddress: string | null;
	userAgent: string | null;
}

export interface AuthSession {
	user: AuthUser;
	session: AuthSessionRecord;
}

interface SessionResult {
	data: AuthSession | null;
	error: unknown;
}

interface SessionState {
	data: AuthSession | null;
	isPending: boolean;
	error: unknown;
	refetch: () => Promise<void>;
}

const sessionClient = authClient as unknown as {
	getSession: () => Promise<SessionResult>;
	useSession: () => SessionState;
	signOut: () => Promise<{ data: null; error: unknown }>;
};

export const getSession = sessionClient.getSession;
export const useSession = sessionClient.useSession;
export const signOut = sessionClient.signOut;
