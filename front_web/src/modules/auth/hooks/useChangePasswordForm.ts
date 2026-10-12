import { type ChangeEvent, type SubmitEvent, useState } from "react";
import { useChangePassword } from "./useChangePassword";

const initialFormData = {
	currentPassword: "",
	newPassword: "",
};

export function useChangePasswordForm() {
	const [formData, setFormData] = useState(initialFormData);
	const { changePassword, loading, error, success } = useChangePassword();

	function handleChange(event: ChangeEvent<HTMLInputElement>) {
		const { name, value } = event.target;
		setFormData((previousFormData) => ({
			...previousFormData,
			[name]: value,
		}));
	}

	function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault();

		changePassword(
			{
				currentPassword: formData.currentPassword,
				newPassword: formData.newPassword,
			},
			{
				onSuccess: () => {
					setFormData(initialFormData);
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
