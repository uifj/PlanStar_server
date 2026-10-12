import { NotFoundError } from "../../errors/http-errors.js";
import {
	createPaginationMeta,
	getPagination,
	getSorting,
} from "../../pagination/index.js";
import { DEFAULT_VAN_SORT_FIELD, DEFAULT_VAN_SORT_ORDER } from "./constants.js";
import { toVan, toVanSummary } from "./dto.js";
import { vanRepository } from "./repository.js";
import type { VanListQuery } from "./schema.js";

async function findMany(query: VanListQuery) {
	const { skip, take } = getPagination(query);
	const { orderBy } = getSorting(query.sort, query.order, {
		defaultField: DEFAULT_VAN_SORT_FIELD,
		defaultOrder: DEFAULT_VAN_SORT_ORDER,
	});

	const [vans, total] = await Promise.all([
		vanRepository.findMany(
			{
				search: query.search,
				type: query.type,
			},
			{
				skip,
				take,
				orderBy,
			},
		),
		vanRepository.count({
			search: query.search,
			type: query.type,
		}),
	]);

	return {
		data: vans.map(toVanSummary),
		meta: createPaginationMeta({
			page: query.page,
			limit: query.limit,
			total,
		}),
	};
}

async function findById(id: string) {
	const van = await vanRepository.findPublicById(id);

	if (!van) {
		throw new NotFoundError("Van not found.");
	}

	return toVan(van);
}

export const vanService = {
	findMany,
	findById,
};
