import { apiClient } from "@/shared/api/apiClient";
import { apiPaths } from "@/shared/api/endpoints";
import type {
	ChangePasswordRequest,
	SignInRequest,
	SignUpRequest,
	User,
} from "../types";

export async function signInUser({ email, password }: SignInRequest) {
	const response = await apiClient.post(apiPaths.auth.signInEmail, {
		email,
		password,
	});

	return response.data;
}

export async function signUpUser({
	name,
	email,
	password,
	role,
}: SignUpRequest) {
	const path =
		role === "host" ? apiPaths.host.register : apiPaths.auth.signUpEmail;
	const response = await apiClient.post(path, {
		name,
		email,
		password,
	});

	return response.data;
}

export async function changePassword({
	currentPassword,
	newPassword,
}: ChangePasswordRequest) {
	const response = await apiClient.post(apiPaths.auth.changePassword, {
		currentPassword,
		newPassword,
		revokeOtherSessions: true,
	});

	return response.data;
}

export async function getUser() {
	const response = await apiClient.get<User>(apiPaths.me);

	return response.data;
}

export async function signOutUser() {
	await apiClient.post(apiPaths.auth.signOut, {});
}
