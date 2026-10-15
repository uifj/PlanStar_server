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
	type UpdateDataviewInput,
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

	const layout: ViewDetails = { viewType: input.viewType };

	await resolveLayoutKeys(spaceId, source.id, input.viewType, input, layout);

	const view = await dataviewRepository.create({
		spaceId,
		creatorId: user.id,
		name: input.name,
		sourceTypeId: source.id,
		layout: layout as Prisma.InputJsonObject,
		filters: query.filters as unknown as Prisma.InputJsonValue,
		sorts: query.sorts as unknown as Prisma.InputJsonValue,
	});

	return objectService.findById(user, view.id);
}

// Anytype's layout menu groups only by a relation the layout can bucket.
const GROUP_FORMATS: Record<string, string[]> = {
	board: ["select", "multiSelect"],
	calendar: ["date"],
};

type ViewDetails = Record<string, unknown>;

/**
 * Only what the request names can be refused. A view that moves from a board to a
 * gallery keeps a grouping key the gallery ignores, and one that moves to a layout
 * which groups by a different format loses the key instead of the switch - the
 * reference app re-picks a group option rather than turning the request away.
 */
async function resolveLayoutKeys(
	spaceId: string,
	sourceTypeId: string,
	viewType: string,
	input: { coverRelationKey?: string | null; groupRelationKey?: string | null },
	details: ViewDetails,
) {
	const relations = await dataviewRepository.findTypeRelations(
		spaceId,
		sourceTypeId,
	);
	const wanted = GROUP_FORMATS[viewType];

	if (input.coverRelationKey === null) {
		delete details.coverRelationKey;
	}

	if (input.groupRelationKey === null) {
		delete details.groupRelationKey;
	}

	if (input.coverRelationKey) {
		if (!relations.has(input.coverRelationKey)) {
			throw new ValidationError(
				`View cover ${input.coverRelationKey} is not a relation of this type.`,
			);
		}

		details.coverRelationKey = input.coverRelationKey;
	}

	if (input.groupRelationKey) {
		const format = relations.get(input.groupRelationKey);

		if (!format) {
			throw new ValidationError(
				`View group ${input.groupRelationKey} is not a relation of this type.`,
			);
		}

		if (!wanted?.includes(format)) {
			throw new ValidationError(
				`A ${viewType} view cannot group by ${input.groupRelationKey} (${format}).`,
			);
		}

		details.groupRelationKey = input.groupRelationKey;

		return;
	}

	const carried =
		typeof details.groupRelationKey === "string"
			? details.groupRelationKey
			: "";

	if (carried && wanted && !wanted.includes(relations.get(carried) ?? "")) {
		delete details.groupRelationKey;
	}
}

async function update(
	user: AuthUser,
	spaceId: string,
	dataviewId: string,
	input: UpdateDataviewInput,
) {
	const view = await dataviewRepository.findView(spaceId, dataviewId);

	if (!view) {
		throw new NotFoundError("View not found.");
	}

	await ensureSpaceAccess(user.id, spaceId, "writer");

	const sourceTypeId = await dataviewRepository.findSourceTypeId(view.id);

	if (!sourceTypeId) {
		throw new NotFoundError("View source not found.");
	}

	const details = { ...((view.details ?? {}) as ViewDetails) };

	details.viewType = input.viewType ?? String(details.viewType ?? "grid");

	await resolveLayoutKeys(
		spaceId,
		sourceTypeId,
		String(details.viewType),
		input,
		details,
	);

	await dataviewRepository.saveDetails(
		view.id,
		details as Prisma.InputJsonObject,
	);

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
	// An archived object is out of circulation, so no view of the space lists it -
	// the kernel keeps it in the raw list, the view does not (ADR-0012).
	const scope: ObjectFilterInput[] = [
		{ key: "typeId", operator: "equal", value: sourceTypeId },
		{ key: "isArchived", operator: "equal", value: false },
	];
	const sorts: ObjectSortInput[] = config.sorts.length
		? config.sorts
		: DEFAULT_DATAVIEW_SORTS;

	const scoped = await objectService.list(user, spaceId, {
		filters: [...config.filters, ...scope],
		sorts,
		layouts: [...LISTABLE_OBJECT_LAYOUTS],
		page: query.page,
		limit: query.limit,
	});
	// The second pass drops the view's own filters, so the two counters can differ.
	const unfiltered = await objectService.list(user, spaceId, {
		filters: [...scope],
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
	update,
	records,
};
