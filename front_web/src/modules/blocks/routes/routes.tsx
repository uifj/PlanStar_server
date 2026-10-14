import { Route } from "react-router";
import BlockDocPage from "../pages/BlockDocPage";
import { blocksRoutePaths } from "./routePaths";

export const blocksRoutes = (
	<Route path={blocksRoutePaths.devDoc} element={<BlockDocPage />} />
);
