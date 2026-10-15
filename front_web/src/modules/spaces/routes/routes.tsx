import { Route } from "react-router";
import SpaceBrowserPage from "../pages/SpaceBrowserPage";
import { spacesRoutePaths } from "./routePaths";

export const spacesRoutes = (
	<Route path={spacesRoutePaths.browser} element={<SpaceBrowserPage />} />
);
