import { API_PREFIX } from "../../../src/config/constants";

export const api = {
	health: `${API_PREFIX}/health`,
	ready: `${API_PREFIX}/ready`,
	openapi: `${API_PREFIX}/openapi.json`,
};
