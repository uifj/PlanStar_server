import { Route } from "react-router";
import VanDetailPage from "../pages/VanDetailPage";
import VansPage from "../pages/VansPage";
import { vansRoutePaths } from "./routePaths";

export const vansRoutes = (
	<>
		<Route path={vansRoutePaths.root} element={<VansPage />} />
		<Route path={vansRoutePaths.detail} element={<VanDetailPage />} />
	</>
);
