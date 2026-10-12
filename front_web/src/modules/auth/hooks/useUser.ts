import { useQuery } from "@tanstack/react-query";
import { isApiError } from "@/shared/api/apiError";
import { authQueryKeys } from "../queryKeys";
import { getUser } from "../services/authService";

export function useUser() {
	const { data, isPending, error } = useQuery({
		queryKey: authQueryKeys.user,
		queryFn: getUser,
		retry: false,
	});
	const unauthenticated = isApiError(error) && error.status === 401;
	const failed = Boolean(error) && !unauthenticated;

	return {
		user: data,
		loading: isPending,
		error,
		failed,
		unauthenticated,
	};
}
