import { Navigate, Outlet } from "react-router";
import { useAuth } from "@/modules/auth/context/AuthProvider";
import type { AuthRole } from "@/modules/auth/types";
import { paths } from "../routes/paths";
import { getAuthGuardState } from "./authGuardState";

interface RoleRequiredOrGuestProps {
	allowedRoles: AuthRole[];
}

export function RoleRequiredOrGuest({
	allowedRoles,
}: RoleRequiredOrGuestProps) {
	const { status, user } = useAuth();
	const guardState = getAuthGuardState(status);

	if (guardState !== undefined) {
		return guardState;
	}

	if (user && !allowedRoles.includes(user.role)) {
		return <Navigate to={paths.home} replace />;
	}

	return <Outlet />;
}
