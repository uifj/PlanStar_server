import { Route } from "react-router";
import TripPlannerPage from "../pages/TripPlannerPage";
import { agentRoutePaths } from "./routePaths";

export const agentRoutes = (
	<Route path={agentRoutePaths.root} element={<TripPlannerPage />} />
);
