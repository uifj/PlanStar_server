import { useMutation } from "@tanstack/react-query";
import { changePassword } from "../services/authService";

export function useChangePassword() {
	const { mutate, isPending, error, isSuccess } = useMutation({
		mutationFn: changePassword,
	});

	return {
		changePassword: mutate,
		loading: isPending,
		error,
		success: isSuccess,
	};
}
