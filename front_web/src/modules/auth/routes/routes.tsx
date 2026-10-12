import { Route } from "react-router";
import AccountPage from "../pages/AccountPage";
import ChangePasswordPage from "../pages/ChangePasswordPage";
import SignInPage from "../pages/SignInPage";
import SignUpPage from "../pages/SignUpPage";
import { authRoutePaths } from "./routePaths";

export const authGuestRoutes = (
	<>
		<Route path={authRoutePaths.signIn} element={<SignInPage />} />
		<Route path={authRoutePaths.signUp} element={<SignUpPage />} />
	</>
);

export const authProtectedRoutes = (
	<>
		<Route path={authRoutePaths.account}>
			<Route index element={<AccountPage />} />
			<Route
				path={authRoutePaths.changePassword}
				element={<ChangePasswordPage />}
			/>
		</Route>
	</>
);
