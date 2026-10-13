import { Route } from "react-router";
import ObjectSlicePage from "../pages/ObjectSlicePage";
import { objectsRoutePaths } from "./routePaths";

export const objectsRoutes = (
	<Route path={objectsRoutePaths.devSlice} element={<ObjectSlicePage />} />
);
