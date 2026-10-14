import { ensureSpaceAccess } from "../../auth/space-access.js";
import { NotFoundError, ValidationError } from "../../errors/http-errors.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuthUser } from "../../lib/auth.js";
import { LISTABLE_OBJECT_LAYOUTS } from "../objects/constants.js";
import type { ObjectFilterInput, ObjectSortInput } from "../objects/filters.js";
import { objectService } from "../objects/service.js";
import { DEFAULT_DATAVIEW_SORTS } from "./constants.js";
import { dataviewRepository, type ViewRow } from "./repository.js";
import {
	type CreateDataviewInput,
	type DataviewRecordsQuery,
	ViewConfigSchema,
} from "./schema.js";

function viewConfig(view: ViewRow) {
	const parsed = ViewConfigSchema.safeParse(view.details ?? {});

	if (!parsed.success) {
		throw new ValidationError(
			`View ${view.name} has a configuration this build cannot read.`,
		);
	}

	return {
		filters: parsed.data.dataviewFilters as ObjectFilterInput[],
		sorts: parsed.data.dataviewSorts as ObjectSortInput[],
	};
}

async function create(
	user: AuthUser,
	spaceId: string,
	input: CreateDataviewInput,
) {
	await ensureSpaceAccess(user.id, spaceId, "writer");

	const source = await dataviewRepository.findTypeInSpace(
		spaceId,
		input.sourceTypeId,
	);

	if (!source) {
		throw new NotFoundError("Type not found.");
	}

	// Saving a view that cannot compile would fail on every later read (ADR-0012).
	const query = await objectService.validateQuery(
		spaceId,
		input.filters,
		input.sorts,
	);

	const view = await dataviewRepository.create({
		spaceId,
		creatorId: user.id,
		name: input.name,
		sourceTypeId: source.id,
		viewType: input.viewType,
		filters: query.filters as unknown as Prisma.InputJsonValue,
		sorts: query.sorts as unknown as Prisma.InputJsonValue,
	});

	return objectService.findById(user, view.id);
}

async function records(
	user: AuthUser,
	spaceId: string,
	dataviewId: string,
	query: DataviewRecordsQuery,
) {
	const view = await dataviewRepository.findView(spaceId, dataviewId);

	if (!view) {
		throw new NotFoundError("View not found.");
	}

	const sourceTypeId = await dataviewRepository.findSourceTypeId(view.id);

	if (!sourceTypeId) {
		throw new NotFoundError("View source not found.");
	}

	const config = viewConfig(view);
	const scope: ObjectFilterInput = {
		key: "typeId",
		operator: "equal",
		value: sourceTypeId,
	};
	const sorts: ObjectSortInput[] = config.sorts.length
		? config.sorts
		: DEFAULT_DATAVIEW_SORTS;

	const scoped = await objectService.list(user, spaceId, {
		filters: [...config.filters, scope],
		sorts,
		layouts: [...LISTABLE_OBJECT_LAYOUTS],
		page: query.page,
		limit: query.limit,
	});
	// The second pass drops the view's own filters, so the two counters can differ.
	const unfiltered = await objectService.list(user, spaceId, {
		filters: [scope],
		sorts,
		layouts: [...LISTABLE_OBJECT_LAYOUTS],
		page: 1,
		limit: 1,
	});

	return {
		data: scoped.data,
		meta: scoped.meta,
		counters: {
			matched: scoped.meta.total,
			total: unfiltered.meta.total,
		},
	};
}

export const dataviewService = {
	create,
	records,
};
