import { useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type PropsWithChildren,
	useContext,
	useEffect,
	useState,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { useUser } from "../hooks/useUser";
import { authQueryKeys } from "../queryKeys";
import type { User } from "../types";

type AuthStatus =
	| "checking"
	| "authenticated"
	| "anonymous"
	| "failed"
	| "signingOut";

interface AuthContextValue {
	status: AuthStatus;
	user: User | null;
	error: Error | null;
	setAuthenticated: () => Promise<void>;
	startSignOut: () => void;
	signOutSucceeded: () => void;
	signOutFailed: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
	const [isSigningOut, setIsSigningOut] = useState(false);
	const location = useLocation();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { user, loading, error, failed } = useUser();

	const status: AuthStatus = isSigningOut
		? "signingOut"
		: loading
			? "checking"
			: failed
				? "failed"
				: user
					? "authenticated"
					: "anonymous";

	useEffect(() => {
		if (!isSigningOut || location.pathname !== "/") {
			return;
		}

		queryClient.setQueryData(authQueryKeys.user, null);
		setIsSigningOut(false);
	}, [isSigningOut, location.pathname, queryClient]);

	async function setAuthenticated() {
		await queryClient.invalidateQueries({
			queryKey: authQueryKeys.user,
		});
	}

	function startSignOut() {
		setIsSigningOut(true);
	}

	function signOutSucceeded() {
		navigate("/", { replace: true });
	}

	function signOutFailed() {
		setIsSigningOut(false);
	}

	return (
		<AuthContext.Provider
			value={{
				status,
				user: user ?? null,
				error: error instanceof Error ? error : null,
				setAuthenticated,
				startSignOut,
				signOutSucceeded,
				signOutFailed,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const context = useContext(AuthContext);

	if (!context) {
		throw new Error("useAuth must be used within an AuthProvider");
	}

	return context;
}
