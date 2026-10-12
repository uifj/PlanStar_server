import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "@/modules/auth/context/AuthProvider";
import type { AuthRole } from "@/modules/auth/types";
import { bookingsRoutePaths } from "@/modules/bookings/routes";
import { hostRoutePaths } from "@/modules/host/routes";
import { getAuthGuardState } from "./authGuardState";

function getSignedInRedirectPath(role: AuthRole) {
	return role === "host" ? hostRoutePaths.root : bookingsRoutePaths.root;
}

export default function GuestOnly() {
	const { status, user } = useAuth();
	const location = useLocation();
	const guardState = getAuthGuardState(status);

	if (guardState !== undefined) {
		return guardState;
	}

	if (user) {
		const from = location.state?.from;

		return <Navigate to={from ?? getSignedInRedirectPath(user.role)} replace />;
	}

	return <Outlet />;
}
