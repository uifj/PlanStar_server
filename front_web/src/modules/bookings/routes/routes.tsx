import { Route } from "react-router";
import BookingsPage from "../pages/BookingsPage";
import { bookingsRoutePaths } from "./routePaths";

export const bookingsRoutes = (
	<Route path={bookingsRoutePaths.root} element={<BookingsPage />} />
);
