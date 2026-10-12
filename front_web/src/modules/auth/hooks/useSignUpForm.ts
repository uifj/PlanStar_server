import { type ChangeEvent, type SubmitEvent, useState } from "react";
import { useNavigate } from "react-router";
import { authRoutePaths } from "../routes";
import type { AuthRole } from "../types";
import { useSignUp } from "./useSignUp";

interface SignUpFormData {
	name: string;
	email: string;
	password: string;
	role: AuthRole;
}

const initialFormData: SignUpFormData = {
	name: "",
	email: "",
	password: "",
	role: "user",
};

export function useSignUpForm() {
	const [formData, setFormData] = useState(initialFormData);
	const { signUp, loading, error, success } = useSignUp();
	const navigate = useNavigate();

	function handleChange(event: ChangeEvent<HTMLInputElement>) {
		const { name, value } = event.target;

		if (name === "role") {
			setFormData((previousFormData) => ({
				...previousFormData,
				role: value as AuthRole,
			}));
			return;
		}

		setFormData((previousFormData) => ({
			...previousFormData,
			[name]: value,
		}));
	}

	function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault();

		signUp(
			{
				name: formData.name,
				email: formData.email,
				password: formData.password,
				role: formData.role,
			},
			{
				onSuccess: async () => {
					navigate(`/${authRoutePaths.account}`, { replace: true });
				},
			},
		);
	}

	return {
		formData,
		loading,
		error,
		success,
		handleChange,
		handleSubmit,
	};
}
