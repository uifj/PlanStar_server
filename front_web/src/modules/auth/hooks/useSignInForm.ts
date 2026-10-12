import { type ChangeEvent, type SubmitEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { authRoutePaths } from "../routes";
import { useSignIn } from "./useSignIn";

const fallbackRedirectPath = `/${authRoutePaths.account}`;

const initialFormData = {
	email: "",
	password: "",
};

export function useSignInForm() {
	const [signInFormData, setSignInFormData] = useState(initialFormData);
	const { signIn, loading, error } = useSignIn();

	const location = useLocation();
	const navigate = useNavigate();

	const message = location.state?.message;
	const from = location.state?.from ?? fallbackRedirectPath;

	function handleChange(e: ChangeEvent<HTMLInputElement>) {
		const { name, value } = e.target;
		setSignInFormData((prev) => ({
			...prev,
			[name]: value,
		}));
	}

	function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		signIn(signInFormData, {
			onSuccess: () => {
				navigate(from, { replace: true });
			},
		});
	}

	return {
		signInFormData,
		loading,
		error: error?.message,
		message,
		handleChange,
		handleSubmit,
	};
}
