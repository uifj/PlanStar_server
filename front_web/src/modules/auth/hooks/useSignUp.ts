import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../context/AuthProvider";
import { signUpUser } from "../services/authService";

export function useSignUp() {
	const { setAuthenticated } = useAuth();

	const { mutate, isPending, error, isSuccess } = useMutation({
		mutationFn: signUpUser,
		onSuccess: setAuthenticated,
	});

	return {
		signUp: mutate,
		loading: isPending,
		error,
		success: isSuccess,
	};
}
