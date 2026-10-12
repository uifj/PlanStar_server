import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../context/AuthProvider";
import { signInUser } from "../services/authService";

export function useSignIn() {
	const { setAuthenticated } = useAuth();

	const { mutate, isPending, error } = useMutation({
		mutationFn: signInUser,
		onSuccess: setAuthenticated,
	});

	return {
		signIn: mutate,
		loading: isPending,
		error,
	};
}
