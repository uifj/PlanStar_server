import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../context/AuthProvider";
import { signOutUser } from "../services/authService";

export function useSignOut() {
	const { signOutFailed, signOutSucceeded, startSignOut } = useAuth();

	const { mutate, isPending, error } = useMutation({
		mutationFn: signOutUser,
		onMutate: startSignOut,
		onSuccess: signOutSucceeded,
		onError: signOutFailed,
	});

	return {
		signOut: mutate,
		loading: isPending,
		error,
	};
}
