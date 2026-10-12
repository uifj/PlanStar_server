import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "@/modules/auth/context/AuthProvider";
import { authRoutePaths } from "@/modules/auth/routes";
import { getAuthGuardState } from "./authGuardState";

export default function AuthRequired() {
	const location = useLocation();
	const { status } = useAuth();
	const guardState = getAuthGuardState(status);

	if (guardState !== undefined) {
		return guardState;
	}

	if (status === "anonymous") {
		return (
			<Navigate
				to={authRoutePaths.signIn}
				state={{
					message: "You must sign in first",
					from: location.pathname + location.search + location.hash,
				}}
				replace
			/>
		);
	}

	return <Outlet />;
}
