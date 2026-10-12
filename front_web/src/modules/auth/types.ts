export type AuthRole = "user" | "host";

export interface SignInRequest {
	email: string;
	password: string;
}

export interface SignUpRequest {
	name: string;
	email: string;
	password: string;
	role: AuthRole;
}

export interface ChangePasswordRequest {
	currentPassword: string;
	newPassword: string;
}

export interface User {
	id: string;
	name: string;
	email: string;
	role: AuthRole;
}
