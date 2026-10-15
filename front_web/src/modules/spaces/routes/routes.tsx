import { Route } from "react-router";
import ObjectPage from "../pages/ObjectPage";
import SpaceBrowserPage from "../pages/SpaceBrowserPage";
import { spacesRoutePaths } from "./routePaths";

export const spacesRoutes = (
	<>
		<Route path={spacesRoutePaths.browser} element={<SpaceBrowserPage />} />
		<Route
			path={`${spacesRoutePaths.object}/:objectId`}
			element={<ObjectPage />}
		/>
	</>
);
