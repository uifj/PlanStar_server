import { Route, Routes } from "react-router";
import { authGuestRoutes, authProtectedRoutes } from "@/modules/auth/routes";
import { bookingsRoutes } from "@/modules/bookings/routes";
import { hostRoutes } from "@/modules/host/routes";
import { vansRoutes } from "@/modules/vans/routes";
import RootLayout from "../components/RootLayout";
import AuthRequired from "../guards/AuthRequired";
import GuestOnly from "../guards/GuestOnly";
import RoleRequired from "../guards/RoleRequired";
import { RoleRequiredOrGuest } from "../guards/RoleRequiredOrGuest";
import AboutPage from "../pages/AboutPage";
import HomePage from "../pages/HomePage";
import NotFoundPage from "../pages/NotFoundPage";
import { paths } from "./paths";

export function AppRoutes() {
	return (
		<Routes>
			<Route path={paths.home} element={<RootLayout />}>
				<Route index element={<HomePage />} />

				<Route path={paths.about} element={<AboutPage />} />

				{/* Guest + regular user */}
				<Route element={<RoleRequiredOrGuest allowedRoles={["user"]} />}>
					{vansRoutes}
				</Route>

				{/* Guest only */}
				<Route element={<GuestOnly />}>{authGuestRoutes}</Route>

				{/* Any authenticated user */}
				<Route element={<AuthRequired />}>
					{authProtectedRoutes}

					{/* Regular user only */}
					<Route element={<RoleRequired allowedRoles={["user"]} />}>
						{bookingsRoutes}
					</Route>

					{/* Host only */}
					<Route element={<RoleRequired allowedRoles={["host"]} />}>
						{hostRoutes}
					</Route>
				</Route>

				<Route path={paths.notFound} element={<NotFoundPage />} />
			</Route>
		</Routes>
	);
}
