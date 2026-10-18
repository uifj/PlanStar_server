import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

// Anytype's numeric layout for an object type (front_web interface/object.ts:6).
// The Prisma enum cannot hold numeric Anytype layouts yet, so the registry record
// carries the number the shell's U.Object.isTypeLayout and type picker expect.
const LAYOUT_TYPE = 4;
// ObjectLayout.Relation === 5 (front_web interface/object.ts).
const LAYOUT_RELATION = 5;
// ObjectLayout.Option === 13 (front_web interface/object.ts).
const LAYOUT_OPTION = 13;
// ObjectLayout.Participant === 19 (front_web interface/object.ts).
const LAYOUT_PARTICIPANT = 19;

// Prisma SpacePermission -> Anytype's numeric ParticipantPermissions
// (interface/space.ts:48-53: Reader 0, Writer 1, Owner 2, None 3, Admin 4).
const PARTICIPANT_PERMISSIONS: Record<string, number> = {
	reader: 0,
	writer: 1,
	owner: 2,
	admin: 4,
};

// Prisma SpaceMemberStatus -> Anytype's numeric ParticipantStatus
// (interface/space.ts:56-62: Joining 0, Active 1, Removed 2).
const PARTICIPANT_STATUS: Record<string, number> = {
	joining: 0,
	active: 1,
	removed: 2,
};

// Prisma RelationFormat -> Anytype's numeric RelationType (interface/object.ts:36-51).
export const RELATION_FORMAT: Record<string, number> = {
	longText: 0,
	shortText: 1,
	number: 2,
	select: 3,
	date: 4,
	checkbox: 6,
	multiSelect: 11,
	object: 100,
};

// A type record the shell reads through J.Relation.default + J.Relation.type. The
// type picker keys off uniqueKey -> id (S.Record.typeKeyMap), so those plus the
// layout/recommended-relation fields must be present and correctly numbered.
function typeRecord(type: {
	id: string;
	spaceId: string;
	uniqueKey: string;
	name: string;
	description: string | null;
	iconEmoji: string | null;
	orderId: string;
	createdAt: Date;
	relations: { id: string }[];
}) {
	const createdDate = Math.floor(type.createdAt.getTime() / 1000);

	return {
		id: type.id,
		spaceId: type.spaceId,
		name: type.name,
		description: type.description ?? "",
		snippet: "",
		iconEmoji: type.iconEmoji ?? "",
		iconImage: "",
		iconName: "",
		iconOption: 0,
		relationFormat: 0,
		type: [],
		layout: LAYOUT_TYPE,
		resolvedLayout: LAYOUT_TYPE,
		isHidden: false,
		isArchived: false,
		isReadonly: false,
		isDeleted: false,
		done: false,
		fileExt: "",
		fileMimeType: "",
		sizeInBytes: 0,
		restrictions: [],
		defaultTemplateId: "",
		createdDate,
		timestamp: createdDate,
		discussionId: "",
		// J.Relation.type
		featuredRelations: [],
		recommendedRelations: type.relations.map((relation) => relation.id),
		recommendedFeaturedRelations: [],
		recommendedHiddenRelations: [],
		recommendedFileRelations: [],
		recommendedLayout: 0,
		sourceObject: "",
		uniqueKey: (type as { uniqueKey: string }).uniqueKey,
		defaultTypeId: "",
		defaultViewType: 0,
		layoutAlign: 0,
		layoutWidth: 0,
		pluralName: "",
		headerRelationsLayout: 0,
		setOf: [],
		orderId: type.orderId,
	};
}

// The space's object-type registry, projected into subscription records. ObjectType
// is the source of truth (ADR-0005); the mirror Obj row exists for object-core reads
// but the shell's type subscription is answered straight from the registry.
export async function typeRecords(spaceId: string) {
	const types = await prisma.objectType.findMany({
		where: { spaceId },
		include: { relations: true },
		orderBy: { name: "asc" },
	});

	return types.map(typeRecord);
}

// The relations only a type record carries. The shell's type picker
// (component/menu/type/suggest.tsx) asks ObjectSearch for the space's types by filtering on these,
// so a query naming one is a request for the registry rather than for the space's objects.
const TYPE_RELATIONS = new Set([
	"uniqueKey",
	"recommendedLayout",
	"recommendedRelations",
	"recommendedFeaturedRelations",
	"recommendedHiddenRelations",
	"recommendedFileRelations",
	"defaultTemplateId",
	"sourceObject",
	"pluralName",
]);

// I.FilterCondition (interface/block/dataview.ts:60).
const CONDITION_EQUAL = 1;
const CONDITION_NOT_EQUAL = 2;
const CONDITION_LIKE = 7;
const CONDITION_IN = 9;
const CONDITION_NOT_IN = 10;

interface PickerFilter {
	RelationKey?: unknown;
	condition?: unknown;
	value?: unknown;
}

function pickerFilters(wireFilters: unknown): PickerFilter[] {
	if (!Array.isArray(wireFilters)) {
		return [];
	}
	return wireFilters.filter(
		(raw): raw is PickerFilter => !!raw && typeof raw === "object",
	);
}

export function isTypePickerQuery(wireFilters: unknown) {
	return pickerFilters(wireFilters).some(
		(filter) =>
			typeof filter.RelationKey === "string" &&
			!filter.RelationKey.includes(".") &&
			TYPE_RELATIONS.has(filter.RelationKey),
	);
}

function sameValue(expected: unknown, actual: unknown): boolean {
	if (Array.isArray(actual)) {
		return actual.some((item) => sameValue(expected, item));
	}
	if (
		typeof expected === "number" ||
		typeof expected === "boolean" ||
		typeof expected === "string"
	) {
		return expected === actual;
	}
	return false;
}

function matchesCondition(
	condition: number,
	expected: unknown,
	actual: unknown,
): boolean {
	const list = Array.isArray(expected) ? expected : [expected];

	switch (condition) {
		case CONDITION_EQUAL:
		case CONDITION_IN:
			return list.some((item) => sameValue(item, actual));
		case CONDITION_NOT_EQUAL:
		case CONDITION_NOT_IN:
			return !list.some((item) => sameValue(item, actual));
		case CONDITION_LIKE:
			return String(actual ?? "")
				.toLowerCase()
				.includes(String(list[0] ?? "").toLowerCase());
		default:
			// An unhandled condition contributes no constraint rather than wrongly narrowing.
			return true;
	}
}

// Narrow a registry projection by the client's wire filters. A registry record is not an Obj row the
// column-backed compiler can compare against, so every condition is tested in memory over the
// projected fields; a filter on a field the projection does not carry simply does not match, which
// is why unhandled conditions keep the row rather than wrongly dropping it.
function matchesFilters(
	record: Record<string, unknown>,
	wireFilters: unknown[],
): boolean {
	return wireFilters.every((raw) => {
		const filter = raw as {
			RelationKey?: unknown;
			condition?: unknown;
			value?: unknown;
		};
		if (typeof filter.RelationKey !== "string") {
			return true;
		}
		const condition =
			typeof filter.condition === "number" ? filter.condition : 0;
		return matchesCondition(
			condition,
			filter.value,
			record[filter.RelationKey],
		);
	});
}

// ObjectSearch for the type picker: the registry projection narrowed in memory, because a type
// record is not an Obj row the column-backed filter compiler can compare against. The picker sends
// no text when it opens, so without this the create menu has nothing to list.
export async function searchTypeRecords(
	spaceId: string,
	wireFilters: unknown,
	fullText: string,
	limit: number,
	offset: number,
) {
	const records: Record<string, unknown>[] = await typeRecords(spaceId);
	const filters = pickerFilters(wireFilters);
	const query = fullText.trim().toLowerCase();

	const matched = records.filter((record) => {
		if (query) {
			const name = String(record.name ?? "").toLowerCase();
			const uniqueKey = String(record.uniqueKey ?? "").toLowerCase();
			if (!name.includes(query) && !uniqueKey.includes(query)) {
				return false;
			}
		}

		return matchesFilters(record, filters);
	});

	return matched.slice(offset, offset + limit);
}

// The settings content-model rail (component/sidebar/page/settings/library.tsx) lists the space's
// types or its properties under the bare `library` subId, filtered by resolvedLayout. Those records
// are registry rows — the type/relation mirror rows are deliberately hidden from the object lists,
// so the general object-list branch cannot serve this rail and it renders empty. Pick the registry
// the layout filter names and narrow it by the rest of the filters (the rail's search sends an
// `id In [...]`, and its own guard excludes the Type object by uniqueKey).
export async function libraryRecords(spaceId: string, wireFilters: unknown) {
	const filters = Array.isArray(wireFilters) ? wireFilters : [];
	const layouts = new Set(
		filters
			.filter(
				(raw) =>
					(raw as { RelationKey?: unknown }).RelationKey === "resolvedLayout",
			)
			.map((raw) => (raw as { value?: unknown }).value)
			.filter((value): value is number => typeof value === "number"),
	);

	const records: Record<string, unknown>[] = [];
	if (layouts.has(LAYOUT_TYPE)) {
		records.push(
			...((await typeRecords(spaceId)) as Record<string, unknown>[]),
		);
	}
	if (layouts.has(LAYOUT_RELATION)) {
		records.push(
			...((await relationRecords(spaceId)) as Record<string, unknown>[]),
		);
	}

	return records.filter((record) => matchesFilters(record, filters));
}

// The same registry projection for a single freshly created type, so the create
// command answers with exactly the record the type subscription will later carry
// (layout 4, uniqueKey, recommendedRelations). Returns null when the id is gone.
export async function typeRecordById(id: string) {
	const type = await prisma.objectType.findUnique({
		where: { id },
		include: { relations: true },
	});

	return type ? typeRecord(type) : null;
}

// ObjectTypeListConflictingRelations backs the type sidebar's "found relations" list
// (sidebar/section/type/relation.tsx:95): a relation "conflicts" with a type when a live object of
// that type carries a value for it but the type does not install it, so the editor offers to add it.
// A relation is installed when Relation.typeId points at the type; a value is carried when the key
// appears in an object's details JSONB (the command write path) or as an object-format Link row (the
// Phase-2 write path). Only keys that resolve to a real Relation in the space are returned, so system
// detail keys (name/type/layout/...) and structural link keys (collection/block/dataview) drop out and
// the client's own system-key filter is a second net. Returns the relation ids ordered by name, or null
// when the type is unknown or belongs to another space so the shim can answer NOT_FOUND.
export async function conflictingRelationIds(
	spaceId: string,
	typeObjectId: string,
) {
	const type = await prisma.objectType.findUnique({
		where: { id: typeObjectId },
		include: { relations: { select: { uniqueKey: true } } },
	});
	if (!type || type.spaceId !== spaceId) {
		return null;
	}

	const installed = new Set(type.relations.map((it) => it.uniqueKey));

	const objects = await prisma.obj.findMany({
		where: { spaceId, typeId: typeObjectId, isDeleted: false },
		select: { id: true, details: true },
	});

	const used = new Set<string>();
	for (const obj of objects) {
		if (
			obj.details &&
			typeof obj.details === "object" &&
			!Array.isArray(obj.details)
		) {
			for (const key of Object.keys(obj.details as Record<string, unknown>)) {
				if (!installed.has(key)) {
					used.add(key);
				}
			}
		}
	}

	if (objects.length > 0) {
		const links = await prisma.link.findMany({
			where: { fromId: { in: objects.map((it) => it.id) } },
			select: { relationKey: true },
			distinct: ["relationKey"],
		});
		for (const link of links) {
			if (!installed.has(link.relationKey)) {
				used.add(link.relationKey);
			}
		}
	}

	if (used.size === 0) {
		return [];
	}

	const relations = await prisma.relation.findMany({
		where: { spaceId, uniqueKey: { in: [...used] } },
		select: { id: true },
		orderBy: { name: "asc" },
	});

	return relations.map((it) => it.id);
}

// A relation record the shell reads through J.Relation.relation. The relation
// subscription keys S.Record.relationKeyMap off (spaceId, relationKey, id), and the
// dataview/property editors read the numeric relationFormat, so those must be exact.
function relationRecord(relation: {
	id: string;
	spaceId: string;
	uniqueKey: string;
	name: string;
	description: string | null;
	format: string;
	isReadOnly: boolean;
	isHidden: boolean;
	maxCount: number | null;
	defaultValue: unknown;
	createdAt: Date;
}) {
	const createdDate = Math.floor(relation.createdAt.getTime() / 1000);

	return {
		id: relation.id,
		spaceId: relation.spaceId,
		name: relation.name,
		description: relation.description ?? "",
		snippet: "",
		iconEmoji: "",
		iconImage: "",
		iconName: "",
		iconOption: 0,
		relationFormat: RELATION_FORMAT[relation.format] ?? 0,
		relationKey: relation.uniqueKey,
		relationMaxCount: relation.maxCount ?? 0,
		relationReadonlyValue: false,
		relationDefaultValue: relation.defaultValue ?? null,
		relationFormatObjectTypes: [],
		relationFormatIncludeTime: false,
		type: [],
		layout: LAYOUT_RELATION,
		resolvedLayout: LAYOUT_RELATION,
		isReadonly: relation.isReadOnly,
		isHidden: relation.isHidden,
		isArchived: false,
		isDeleted: false,
		done: false,
		fileExt: "",
		fileMimeType: "",
		sizeInBytes: 0,
		restrictions: [],
		defaultTemplateId: "",
		sourceObject: "",
		createdDate,
		timestamp: createdDate,
		discussionId: "",
	};
}

// The space's relation registry, projected into subscription records.
export async function relationRecords(spaceId: string) {
	const relations = await prisma.relation.findMany({
		where: { spaceId },
		orderBy: { name: "asc" },
	});

	return relations.map(relationRecord);
}

// The same registry projection for a single freshly created relation, so the create
// command answers with exactly the record the relation subscription will later carry
// (layout 5, numeric relationFormat, relationKey). Returns null when the id is gone.
export async function relationRecordById(id: string) {
	const relation = await prisma.relation.findUnique({ where: { id } });

	return relation ? relationRecord(relation) : null;
}

// An option record the shell reads through S.Record.getOption. Options carry the
// relationKey they belong to plus relationOptionColor (the detail key the client
// reads at store/detail.ts:18), projected as Option-layout (13) records.
function optionRecord(option: {
	id: string;
	spaceId: string;
	relationKey: string;
	name: string;
	color: string;
	createdAt: Date;
}) {
	const createdDate = Math.floor(option.createdAt.getTime() / 1000);

	return {
		id: option.id,
		spaceId: option.spaceId,
		name: option.name,
		description: "",
		snippet: "",
		iconEmoji: "",
		iconImage: "",
		iconName: "",
		iconOption: 0,
		relationFormat: 0,
		relationKey: option.relationKey,
		relationOptionColor: option.color,
		type: [],
		layout: LAYOUT_OPTION,
		resolvedLayout: LAYOUT_OPTION,
		isHidden: false,
		isArchived: false,
		isReadonly: false,
		isDeleted: false,
		done: false,
		fileExt: "",
		fileMimeType: "",
		sizeInBytes: 0,
		restrictions: [],
		defaultTemplateId: "",
		sourceObject: "",
		createdDate,
		timestamp: createdDate,
		discussionId: "",
	};
}

// The space's relation-option registry, projected into subscription records. Options
// sort by the caller's dragged order first, then creation time for any still at the
// default (so a fresh option lands after the explicitly ordered ones).
export async function optionRecords(spaceId: string) {
	const options = await prisma.relationOption.findMany({
		where: { spaceId },
		orderBy: [{ optionOrder: "asc" }, { createdAt: "asc" }],
	});

	return options.map(optionRecord);
}

// A board view's columns for a group relation: one group per option, in the caller's
// dragged order. A select column reads obj.status.id as its value while a multiSelect (tag)
// column reads obj.tag.ids (mapper.ts:495-496), so the group carries the shape the relation's
// format expects.
export async function boardGroups(spaceId: string, relationKey: string) {
	const relation = await prisma.relation.findUnique({
		where: { spaceId_uniqueKey: { spaceId, uniqueKey: relationKey } },
		select: { format: true },
	});
	const isTag = relation?.format === "multiSelect";

	const options = await prisma.relationOption.findMany({
		where: { spaceId, relationKey },
		orderBy: [{ optionOrder: "asc" }, { createdAt: "asc" }],
	});

	return options.map((option) =>
		isTag
			? { id: option.id, tag: { ids: [option.id] } }
			: { id: option.id, status: { id: option.id } },
	);
}

// The date page asks which relations reference an object so it can list "what points at this
// date" (date.tsx:69 -> response.ts:797 { relationKey, counter }). Object-format relation values
// are written through ObjectListSetDetails into Obj.details JSONB (block/relation.tsx:80), not
// into Link, so the reverse lookup reads that store: for each object-format relation in the
// space, count the non-deleted objects whose value list contains `value`. The details GIN index
// (obj_details_gin) serves the array-contains probe. Relations nothing references are omitted;
// an empty `value` matches nothing.
export async function relationsWithValue(spaceId: string, value: string) {
	if (!value) {
		return [];
	}

	const relations = await prisma.relation.findMany({
		where: { spaceId, format: "object" },
		select: { uniqueKey: true },
	});

	const list: { relationKey: string; counter: number }[] = [];
	for (const relation of relations) {
		const counter = await prisma.obj.count({
			where: {
				spaceId,
				isDeleted: false,
				details: { path: [relation.uniqueKey], array_contains: [value] },
			} as Prisma.ObjWhereInput,
		});
		if (counter > 0) {
			list.push({ relationKey: relation.uniqueKey, counter });
		}
	}

	return list;
}

// Persist a dragged option order for one relation: each id takes its index as the
// option's order. updateMany is scoped to {spaceId, relationKey}, so an id that is not an
// option of this relation matches nothing and a stale client list can never reorder
// another relation's options.
export async function setRelationOptionOrder(
	spaceId: string,
	relationKey: string,
	optionIds: string[],
) {
	await prisma.$transaction(
		optionIds.map((id, index) =>
			prisma.relationOption.updateMany({
				where: { id, spaceId, relationKey },
				data: { optionOrder: index },
			}),
		),
	);

	return optionIds;
}

// Width of the zero-padded decimal order key. Fixed so keys assigned by separate
// ObjectTypeSetOrder calls stay lexicographically comparable; the client's sortByOrderId
// (record.ts:611 -> U.Data.sortByOrderId) is a plain string compare, and an empty orderId
// (a type never ordered) sorts last.
const TYPE_ORDER_WIDTH = 6;

// Persist a dragged type order for one space (widget/object.tsx:244 -> ObjectTypeSetOrder).
// Each id takes a strictly-increasing lexicographic key by its position so the type rail
// restores the arrangement on reload. The client always sends the full ordered list, so every
// type is reassigned each call. updateMany is scoped to { spaceId, id }, so an id that is not a
// type of this space matches nothing and a stale list can never reorder another space's types.
// Returns the keys positionally to echo back as the response's orderIds.
export async function setTypeOrder(spaceId: string, typeIds: string[]) {
	const orderIds = typeIds.map((_, index) =>
		String(index).padStart(TYPE_ORDER_WIDTH, "0"),
	);

	await prisma.$transaction(
		typeIds.map((id, index) =>
			prisma.objectType.updateMany({
				where: { id, spaceId },
				data: { orderId: orderIds[index] },
			}),
		),
	);

	return orderIds;
}

// U.Space.getParticipantId derives `_participant_<spaceId>_<accountId>` (dots in the
// spaceId replaced), and S.Detail.get looks the current user up by exactly that id, so
// the participant record's id must be built the same way.
export function participantId(spaceId: string, accountId: string) {
	return `_participant_${spaceId.replace(/\./g, "_")}_${accountId}`;
}

function participantRecord(member: {
	spaceId: string;
	userId: string;
	permission: string;
	status: string;
	user: { name: string };
}) {
	return {
		id: participantId(member.spaceId, member.userId),
		spaceId: member.spaceId,
		name: member.user.name,
		description: "",
		snippet: "",
		iconEmoji: "",
		iconImage: "",
		iconName: "",
		iconOption: 0,
		relationFormat: 0,
		identity: member.userId,
		globalName: member.user.name,
		participantPermissions: PARTICIPANT_PERMISSIONS[member.permission] ?? 0,
		participantStatus: PARTICIPANT_STATUS[member.status] ?? 1,
		type: [],
		layout: LAYOUT_PARTICIPANT,
		resolvedLayout: LAYOUT_PARTICIPANT,
		isHidden: false,
		isArchived: false,
		isReadonly: false,
		isDeleted: false,
		done: false,
		fileExt: "",
		fileMimeType: "",
		sizeInBytes: 0,
		restrictions: [],
		defaultTemplateId: "",
		sourceObject: "",
		discussionId: "",
	};
}

// The space's members, projected into participant subscription records.
export async function participantRecords(spaceId: string) {
	const members = await prisma.spaceMember.findMany({
		where: { spaceId },
		include: { user: { select: { name: true } } },
	});

	return members.map(participantRecord);
}

// ObjectLayout.Page === 0 (front_web interface/object.ts). The Prisma enum stores a
// name, so the subscription record carries the number the shell's layout guards read.
const LAYOUT_PAGE = 0;
// ObjectLayout.Collection === 14 (front_web interface/object.ts:16).
const LAYOUT_COLLECTION = 14;
// ObjectLayout.Set === 3 (front_web interface/object.ts:5).
const LAYOUT_SET = 3;
// File layouts (front_web interface/object.ts): File = 6, Image = 8, Audio = 15,
// Video = 16, Pdf = 20. A file object's resolvedLayout is one of these, chosen from
// the uploaded content's mime type.
const LAYOUT_FILE = 6;
const LAYOUT_IMAGE = 8;
const LAYOUT_AUDIO = 15;
const LAYOUT_VIDEO = 16;
const LAYOUT_PDF = 20;
// ObjectLayout.Bookmark === 11 (front_web interface/object.ts:13).
const LAYOUT_BOOKMARK = 11;
// ObjectLayout.Discussion === 27 (front_web interface/object.ts): the per-object comment
// chat ObjectAddDiscussion mints. isChatLayout(27) is true, so the shell treats it as a
// chat feed rather than a page.
const LAYOUT_DISCUSSION = 27;
// ObjectLayout.Date === 17 (front_web interface/object.ts:19): the per-day date object
// ObjectDateByTimestamp finds-or-creates. isDateLayout(17) is true, so the shell renders it
// from its timestamp detail rather than a plain page title.
const LAYOUT_DATE = 17;
const NUMERIC_LAYOUT: Record<string, number> = {
	basic: 0,
	relation: LAYOUT_RELATION,
	objectType: LAYOUT_TYPE,
	dataview: 0,
	collection: LAYOUT_COLLECTION,
	set: LAYOUT_SET,
	file: LAYOUT_FILE,
	image: LAYOUT_IMAGE,
	audio: LAYOUT_AUDIO,
	video: LAYOUT_VIDEO,
	pdf: LAYOUT_PDF,
	bookmark: LAYOUT_BOOKMARK,
	discussion: LAYOUT_DISCUSSION,
	date: LAYOUT_DATE,
};

// The one place that turns a stored layout into the number the shell switches screens on. The
// resolvedLayout column is authoritative; the details.layout marker is the fallback because the
// creation paths lay it down and ObjectRelationDelete lets the client lift it off by name.
export function numericLayout(row: {
	resolvedLayout?: string | null;
	details?: unknown;
}): number {
	const fromColumn = row.resolvedLayout
		? NUMERIC_LAYOUT[row.resolvedLayout]
		: undefined;
	if (fromColumn !== undefined) {
		return fromColumn;
	}

	const details =
		row.details &&
		typeof row.details === "object" &&
		!Array.isArray(row.details)
			? (row.details as Record<string, unknown>)
			: {};
	const marker = typeof details.layout === "string" ? details.layout : "";

	return NUMERIC_LAYOUT[marker] ?? LAYOUT_PAGE;
}

// A plain object projected into the J.Relation.default record shape the recent
// subscriptions render (home "recently edited" list). lastModifiedDate rides on
// updatedAt; there is no per-object last-modifier column yet, so recentEditMe scopes
// by creatorId — the only authorship signal the schema tracks.
function objectRecord(obj: {
	id: string;
	spaceId: string;
	name: string;
	description: string | null;
	snippet: string | null;
	iconEmoji: string | null;
	typeId: string | null;
	resolvedLayout: string;
	isArchived: boolean;
	isDeleted: boolean;
	isHidden: boolean;
	isFavorite: boolean;
	done: boolean | null;
	createdAt: Date;
	updatedAt: Date;
	details?: Prisma.JsonValue;
}) {
	const createdDate = Math.floor(obj.createdAt.getTime() / 1000);
	const lastModifiedDate = Math.floor(obj.updatedAt.getTime() / 1000);
	const layout = NUMERIC_LAYOUT[obj.resolvedLayout] ?? LAYOUT_PAGE;

	// Custom relation values live in the details JSONB (ADR-0002); a dataview reads each
	// cell as a top-level record[relationKey], so they are spread on first and the system
	// fields below override any colliding key (id/name/layout/type/...).
	const custom =
		obj.details &&
		typeof obj.details === "object" &&
		!Array.isArray(obj.details)
			? (obj.details as Record<string, unknown>)
			: {};

	return {
		...custom,
		id: obj.id,
		spaceId: obj.spaceId,
		name: obj.name,
		description: obj.description ?? "",
		snippet: obj.snippet ?? "",
		iconEmoji: obj.iconEmoji ?? "",
		iconImage: typeof custom.iconImage === "string" ? custom.iconImage : "",
		iconName: "",
		iconOption: 0,
		relationFormat: 0,
		type: obj.typeId ? [obj.typeId] : [],
		layout,
		resolvedLayout: layout,
		isHidden: obj.isHidden,
		isArchived: obj.isArchived,
		isFavorite: obj.isFavorite,
		isReadonly: false,
		isDeleted: obj.isDeleted,
		done: obj.done ?? false,
		// File objects carry their metadata in the details JSONB (ADR-0002); the spread
		// above would otherwise be overridden here, so re-project it from `custom`.
		fileExt: typeof custom.fileExt === "string" ? custom.fileExt : "",
		fileMimeType:
			typeof custom.fileMimeType === "string" ? custom.fileMimeType : "",
		sizeInBytes:
			typeof custom.sizeInBytes === "number" ? custom.sizeInBytes : 0,
		// A list of numeric flags, not an object: S.Block.isAllowed reads it with
		// restrictions.indexOf(), so "no restrictions" is [] and never {} — an object there
		// throws inside the widget and library rows that check it.
		restrictions: [],
		defaultTemplateId: "",
		createdDate,
		timestamp: lastModifiedDate,
		// The parent -> discussion link lives in the details JSONB (ObjectAddDiscussion writes
		// it), so project it from `custom` rather than blanking it — the discussionGlobal
		// subscription filters parents by `discussionId NotEmpty` and section.tsx re-reads it.
		discussionId:
			typeof custom.discussionId === "string" ? custom.discussionId : "",
		lastModifiedDate,
	};
}

// The trash subscription keys off ids only (subscription.ts createSpace: keys []),
// so a minimal { id } record is the honest match for the client's contract.
export async function deletedRecords(spaceId: string) {
	const rows = await prisma.obj.findMany({
		where: { spaceId, isDeleted: true },
		select: { id: true },
	});

	return rows.map((row) => ({ id: row.id }));
}

// The space deletion audit (settings/space/deletionAudit.tsx -> ObjectDeletionAudit) reads the
// same soft-deleted rows the Bin does, but as an audit trail: each record carries the removal
// stamp and isUninstalled:false (a deleted object, as opposed to an uninstalled type/property).
// deletedDate is projected to unix seconds to match every other date the client reads.
export async function deletionAuditRecords(
	spaceId: string,
	offset: number,
	limit: number,
) {
	const where = { spaceId, isDeleted: true };

	// total is the whole trail, not the page: the client shows "Show more" while
	// records.length < total, so it has to keep counting rows the current page omits.
	const [rows, total] = await Promise.all([
		prisma.obj.findMany({
			where,
			select: {
				id: true,
				name: true,
				typeId: true,
				resolvedLayout: true,
				creatorId: true,
				createdAt: true,
				deletedDate: true,
				deletedBy: true,
			},
			// Newest removal first; rows deleted before the audit stamp existed (deletedDate
			// null) have no position in the trail, so they sort last rather than masquerading
			// as recent.
			orderBy: { deletedDate: { sort: "desc", nulls: "last" } },
			skip: offset,
			take: limit,
		}),
		prisma.obj.count({ where }),
	]);

	const records = rows.map((row) => {
		const layout = NUMERIC_LAYOUT[row.resolvedLayout] ?? LAYOUT_PAGE;
		return {
			id: row.id,
			isUninstalled: false,
			name: row.name,
			type: row.typeId ? [row.typeId] : [],
			layout,
			resolvedLayout: layout,
			createdDate: Math.floor(row.createdAt.getTime() / 1000),
			deletedDate: row.deletedDate
				? Math.floor(row.deletedDate.getTime() / 1000)
				: 0,
			// deletedBy/creator are stored as user ids; the client resolves a name from the
			// participant record, whose id is derived the same way participantRecords derives it.
			// An actorless delete (system/GC) or a space whose creator row is gone projects "".
			deletedBy: row.deletedBy ? participantId(spaceId, row.deletedBy) : "",
			creator: row.creatorId ? participantId(spaceId, row.creatorId) : "",
		};
	});

	return { records, total };
}

// front_web interface/common.ts:86 CleanupReason. Only the reasons the web backend can prove
// from the object rows are produced here: a createdInContext parent that is archived, or that is
// deleted/gone. ContextUnlinked (3) is intentionally not emitted — deciding that a live context no
// longer links to its child needs the body link graph, which is deferred with the P3 body model.
const CLEANUP_REASON_NONE = 0;
const CLEANUP_REASON_CONTEXT_ARCHIVED = 1;
const CLEANUP_REASON_CONTEXT_DELETED = 2;

// The Bin's "Suggested for cleanup" forest (archiveSuggested.tsx:81 -> ObjectCleanupSuggestions).
// An orphan ROOT is a live object — neither binned nor archived itself, since those are already out
// of the way — whose createdInContext parent is archived or deleted/gone. Objects created inside an
// orphan are pulled in as DESCENDANTS (isRoot:false, reason None) so cleaning up a root takes its
// subtree with it. Items are sorted by id so the client's parent->child forest join is stable.
export async function cleanupSuggestions(spaceId: string) {
	const rows = await prisma.obj.findMany({
		where: { spaceId },
		select: {
			id: true,
			spaceId: true,
			name: true,
			description: true,
			snippet: true,
			iconEmoji: true,
			typeId: true,
			resolvedLayout: true,
			isArchived: true,
			isDeleted: true,
			isHidden: true,
			isFavorite: true,
			cleanupIgnored: true,
			done: true,
			createdAt: true,
			updatedAt: true,
			details: true,
		},
	});

	type ObjRow = (typeof rows)[number];
	const byId = new Map<string, ObjRow>(rows.map((row) => [row.id, row]));

	const contextOf = (row: ObjRow) => {
		const details = row.details;
		if (details && typeof details === "object" && !Array.isArray(details)) {
			const value = (details as Record<string, unknown>).createdInContext;
			return typeof value === "string" ? value : "";
		}
		return "";
	};

	const live = rows.filter((row) => !row.isDeleted && !row.isArchived);

	// An ignored object is dismissed from the forest (ObjectCleanupSuggestionIgnore). Because the
	// descendant walk below only reaches a child through an already-included parent, dropping an
	// ignored root here silently drops its whole subtree too — exactly the "ignoring an object also
	// drops its descendants" contract the client documents.
	const candidates = live.filter((row) => !row.cleanupIgnored);

	const rootReason = (row: ObjRow): number | null => {
		const contextId = contextOf(row);
		if (!contextId) {
			return null;
		}
		const context = byId.get(contextId);
		// A context missing from the space (hard-deleted, or an id from another space) is as gone
		// as one soft-deleted into the Bin: the child no longer has a live home.
		if (!context || context.isDeleted) {
			return CLEANUP_REASON_CONTEXT_DELETED;
		}
		if (context.isArchived) {
			return CLEANUP_REASON_CONTEXT_ARCHIVED;
		}
		return null;
	};

	const included = new Map<string, { isRoot: boolean; reason: number }>();
	for (const row of candidates) {
		const reason = rootReason(row);
		if (reason !== null) {
			included.set(row.id, { isRoot: true, reason });
		}
	}

	// Descendant closure to a fixpoint: a live object joins the forest once the object it was
	// created in is itself an orphan. The `included.has` guard means a self- or mutually-referential
	// createdInContext chain terminates instead of spinning.
	let grew = true;
	while (grew) {
		grew = false;
		for (const row of candidates) {
			if (included.has(row.id)) {
				continue;
			}
			const contextId = contextOf(row);
			if (contextId && included.has(contextId)) {
				included.set(row.id, { isRoot: false, reason: CLEANUP_REASON_NONE });
				grew = true;
			}
		}
	}

	return rows
		.filter((row) => included.has(row.id))
		.map((row) => {
			const meta = included.get(row.id);
			return {
				details: objectRecord(row),
				isRoot: meta?.isRoot ?? false,
				reason: meta?.reason ?? CLEANUP_REASON_NONE,
			};
		})
		.sort((a, b) =>
			a.details.id < b.details.id ? -1 : a.details.id > b.details.id ? 1 : 0,
		);
}

// ObjectCleanupSuggestionIgnore (command.ts:1663) flips the durable dismissal flag on a batch of
// objects. The write is scoped to the resolved spaceId — never the bare id list — so a caller who
// mixes in an id from a space they cannot write to cannot flip that other space's rows: the access
// check the command ran was for this space only. ignored=false is the reversible path that puts an
// object (and, via the descendant walk in cleanupSuggestions, its subtree) back into the forest.
export async function setCleanupIgnored(
	spaceId: string,
	objectIds: string[],
	ignored: boolean,
) {
	if (objectIds.length === 0) {
		return;
	}

	await prisma.obj.updateMany({
		where: { spaceId, id: { in: objectIds } },
		data: { cleanupIgnored: ignored },
	});
}

// Archived objects that are not also in the trash; the client's base filter keeps
// deleted rows out of the archive view.
export async function archivedRecords(spaceId: string) {
	const rows = await prisma.obj.findMany({
		where: { spaceId, isArchived: true, isDeleted: false },
		select: { id: true },
	});

	return rows.map((row) => ({ id: row.id }));
}

// The home "recently edited" list: live, visible objects newest-first, capped at the
// client's limit of 10. Pass userId to scope to objects that user authored.
export async function recentRecords(spaceId: string, userId?: string) {
	const rows = await prisma.obj.findMany({
		where: {
			spaceId,
			isDeleted: false,
			isArchived: false,
			isHidden: false,
			...(userId ? { creatorId: userId } : {}),
		},
		orderBy: { updatedAt: "desc" },
		take: 10,
	});

	return rows.map(objectRecord);
}

// Global full-text search (ObjectSearch): live, visible objects in the space whose
// name or projected body snippet matches the query, newest-first. The snippet is the
// ADR-0018 rebuildable projection of the Yjs body, so body text is searchable without
// decoding the document at query time.
export async function searchRecords(
	spaceId: string,
	fullText: string,
	limit: number,
	offset: number,
) {
	const query = fullText.trim();
	if (!query) {
		return [];
	}

	const rows = await prisma.obj.findMany({
		where: {
			spaceId,
			isDeleted: false,
			isArchived: false,
			isHidden: false,
			OR: [
				{ name: { contains: query, mode: "insensitive" } },
				{ snippet: { contains: query, mode: "insensitive" } },
			],
		},
		orderBy: { updatedAt: "desc" },
		take: limit,
		skip: offset,
	});

	return rows.map(objectRecord);
}

// One matched field's highlight metadata. The client's Mapper.From.MetaList reads
// highlight/blockId/relationKey/relationDetails/highlightRanges; a name or body-snippet match
// lives on the object rather than in a block, so blockId is empty and relationKey names the
// matched relation. The range points at the first case-insensitive occurrence of the query so
// the search row can highlight exactly what matched.
function fieldMeta(relationKey: string, text: string, query: string) {
	const idx = text.toLowerCase().indexOf(query.toLowerCase());
	if (idx < 0) {
		return null;
	}
	return {
		highlight: text,
		blockId: "",
		relationKey,
		relationDetails: {},
		highlightRanges: [{ from: idx, to: idx + query.length }],
	};
}

// ObjectSearchWithMeta: the same name-or-snippet search as searchRecords, but each hit carries
// the object's detail record on `details` plus per-field highlight metadata on `meta`, which the
// global search popup (popup/search.tsx) renders as highlighted rows. The response mapper reads
// `results: [{ details, meta }]` rather than the flat `records` ObjectSearch returns.
export async function searchRecordsWithMeta(
	spaceId: string,
	fullText: string,
	limit: number,
	offset: number,
) {
	const query = fullText.trim();
	if (!query) {
		return [];
	}

	const rows = await prisma.obj.findMany({
		where: {
			spaceId,
			isDeleted: false,
			isArchived: false,
			isHidden: false,
			OR: [
				{ name: { contains: query, mode: "insensitive" } },
				{ snippet: { contains: query, mode: "insensitive" } },
			],
		},
		orderBy: { updatedAt: "desc" },
		take: limit,
		skip: offset,
	});

	return rows.map((row) => {
		const meta = [];
		const nameMeta = fieldMeta("name", row.name, query);
		if (nameMeta) {
			meta.push(nameMeta);
		}
		const bodyMeta = fieldMeta("description", row.snippet ?? "", query);
		if (bodyMeta) {
			meta.push(bodyMeta);
		}
		return { details: objectRecord(row), meta };
	});
}
// and edges are the object-valued relations between them. Link is the sole store for
// those relations (ADR-0002), so an edge is { source: fromId, target: toId } — kept
// only when both ends resolve to a live node, matching the client's own filter.
// History (Anytype Rpc.History): versions of an object's body are DocumentVersion rows
// written on every collab store. Newest-first, with lastVersionId as the cursor (versions
// strictly older than it). Projected to the client's HistoryVersion shape { id, authorId,
// groupId, time (unix seconds) }; groupId is unused by the self-hosted single-document history.
export async function historyVersions(
	spaceId: string,
	objectId: string,
	lastVersionId: string,
	limit: number,
) {
	let cursorTime: Date | null = null;
	if (lastVersionId) {
		const cursor = await prisma.documentVersion.findFirst({
			where: { id: lastVersionId, spaceId, objectId },
			select: { createdAt: true },
		});
		if (cursor) {
			cursorTime = cursor.createdAt;
		}
	}

	const rows = await prisma.documentVersion.findMany({
		where: {
			spaceId,
			objectId,
			...(cursorTime ? { createdAt: { lt: cursorTime } } : {}),
		},
		orderBy: { createdAt: "desc" },
		...(limit > 0 ? { take: limit } : {}),
	});

	return rows.map((row) => ({
		id: row.id,
		authorId: row.authorId ?? "",
		groupId: "",
		time: Math.floor(row.createdAt.getTime() / 1000),
	}));
}

// One version's stored bytes + projection fields, scoped to the space so a version id
// from another space never resolves. HistoryShowVersion renders its body; HistorySetVersion
// writes it back as current.
export async function documentVersionById(spaceId: string, versionId: string) {
	const row = await prisma.documentVersion.findFirst({
		where: { id: versionId, spaceId },
		select: {
			id: true,
			objectId: true,
			authorId: true,
			createdAt: true,
			state: true,
		},
	});

	if (!row) {
		return null;
	}

	return {
		id: row.id,
		objectId: row.objectId,
		authorId: row.authorId ?? "",
		groupId: "",
		time: Math.floor(row.createdAt.getTime() / 1000),
		state: new Uint8Array(row.state),
	};
}

export async function graphRecords(spaceId: string, limit: number) {
	const rows = await prisma.obj.findMany({
		where: {
			spaceId,
			isDeleted: false,
			isArchived: false,
			isHidden: false,
		},
		orderBy: { updatedAt: "desc" },
		...(limit > 0 ? { take: limit } : {}),
	});

	const nodes = rows.map(objectRecord);
	const nodeIds = new Set(nodes.map((node) => node.id));

	// An object relation lives in one of two stores: the Link table (what a body link projects
	// to) and the object's own details JSONB (where the command write path puts it, ADR-0002).
	// Reading only Link drew 29 nodes and no edges against a space whose links were made in the
	// property editor.
	const [links, relations] = await Promise.all([
		prisma.link.findMany({
			where: { spaceId, fromId: { in: [...nodeIds] } },
			select: { fromId: true, toId: true },
		}),
		prisma.relation.findMany({
			where: { spaceId, format: "object" },
			select: { uniqueKey: true },
		}),
	]);

	// One edge per ordered pair: a link written to both stores must not draw twice.
	const edges = new Map<string, { source: string; target: string }>();
	const addEdge = (source: string, target: string) => {
		if (source === target || !nodeIds.has(source) || !nodeIds.has(target)) {
			return;
		}
		edges.set(`${source}->${target}`, { source, target });
	};

	for (const link of links) {
		addEdge(link.fromId, link.toId);
	}

	const keys = relations.map((relation) => relation.uniqueKey);
	for (const row of rows) {
		const details =
			row.details &&
			typeof row.details === "object" &&
			!Array.isArray(row.details)
				? (row.details as Record<string, unknown>)
				: {};

		for (const key of keys) {
			const value = details[key];
			const list = Array.isArray(value)
				? value
				: value === undefined || value === null
					? []
					: [value];

			for (const item of list) {
				if (typeof item === "string") {
					addEdge(row.id, item);
				}
			}
		}
	}

	return { nodes, edges: [...edges.values()] };
}

// Cross-space search spans every space the caller is an active member of, so the
// readable space set is derived from SpaceMember before any object is matched. Same
// name-or-snippet projection as searchRecords, scoped to that set instead of one space.
export async function crossSpaceSearchRecords(
	userId: string,
	fullText: string,
	limit: number,
	offset: number,
) {
	const query = fullText.trim();
	if (!query) {
		return [];
	}

	const memberships = await prisma.spaceMember.findMany({
		where: { userId, status: "active" },
		select: { spaceId: true },
	});
	const spaceIds = memberships.map((member) => member.spaceId);
	if (spaceIds.length === 0) {
		return [];
	}

	const rows = await prisma.obj.findMany({
		where: {
			spaceId: { in: spaceIds },
			isDeleted: false,
			isArchived: false,
			isHidden: false,
			OR: [
				{ name: { contains: query, mode: "insensitive" } },
				{ snippet: { contains: query, mode: "insensitive" } },
			],
		},
		orderBy: { updatedAt: "desc" },
		take: limit,
		skip: offset,
	});

	return rows.map(objectRecord);
}

// A collection's members are an ordered object-valued relation, so Link is their sole
// store (ADR-0002). The relation key doubles as the write side's marker in
// object-service; both import it from here so the two paths cannot drift.
export const COLLECTION_RELATION = "collection";

export async function collectionRecords(
	spaceId: string,
	collectionId: string,
	filters: Prisma.ObjWhereInput = {},
) {
	const links = await prisma.link.findMany({
		where: { spaceId, fromId: collectionId, relationKey: COLLECTION_RELATION },
		select: { toId: true },
		orderBy: { sortOrder: "asc" },
	});

	const orderedIds = links.map((link) => link.toId);
	if (orderedIds.length === 0) {
		return [];
	}

	const rows = await prisma.obj.findMany({
		where: { id: { in: orderedIds }, isDeleted: false, ...filters },
	});

	const byId = new Map(rows.map((row) => [row.id, objectRecord(row)]));
	return orderedIds
		.map((id) => byId.get(id))
		.filter((record): record is NonNullable<typeof record> => Boolean(record));
}

// A set's records are every live object in the space whose type is one of the set's
// sources (the type ids carried on the subscribe). `filters` and `orderBy` are the translated
// set-query where/order fragments (src/modules/command/set-query.ts); filters AND-combine with
// the source scope, and orderBy overrides the default newest-first order (an id tiebreaker
// keeps paging stable).
export async function setRecords(
	spaceId: string,
	sources: string[],
	filters: Prisma.ObjWhereInput = {},
	orderBy: Prisma.ObjOrderByWithRelationInput[] = [],
	compare?:
		| ((a: Record<string, unknown>, b: Record<string, unknown>) => number)
		| null,
	predicate?: ((row: Record<string, unknown>) => boolean) | null,
) {
	if (sources.length === 0) {
		return [];
	}

	let rows = await prisma.obj.findMany({
		where: {
			spaceId,
			typeId: { in: sources },
			isDeleted: false,
			isArchived: false,
			...filters,
		},
		orderBy: compare
			? { id: "asc" }
			: orderBy.length > 0
				? [...orderBy, { id: "asc" }]
				: { updatedAt: "desc" },
	});

	// A custom-relation Empty/NotEmpty filter cannot ride the Prisma where (its value is in the
	// details JSONB, which the typed path filter cannot test for absence), so the predicate narrows
	// the fetched rows in memory before the sort/map. As with the comparator below, this is complete
	// only because there is no pagination yet — every matching row is fetched.
	if (predicate) {
		rows = rows.filter(predicate);
	}

	// A custom-relation sort cannot ride the Prisma orderBy (its value is in the details JSONB,
	// not a column), so the comparator reorders the whole result set in memory over the
	// deterministic {id:'asc'} base fetched above. There is no pagination yet — every matching
	// row is fetched — so this in-memory sort is the complete ordered set the subscriber renders.
	if (compare) {
		rows.sort(compare);
	}

	return rows.map(objectRecord);
}

// The general object-list subscription: every live object in the space matching the translated
// client filters, projected via objectRecord. This backs the sidebar object-list widgets (All
// objects / Favorites / Bin) and the per-widget tree/list subscriptions, whose ObjectSearchSubscribe
// carries filters + keys + sorts but no collectionId and no set `source`. The client's
// U.Subscription.getBaseFilters already injected isDeleted/isArchived/isHidden NotEqual true (and
// the widget adds isFavorite/isArchived/resolvedLayout constraints), so `filters` narrows faithfully;
// isDeleted is excluded again here as a floor because no object list ever shows trashed rows (the Bin
// widget selects archived, not deleted, objects). `orderBy` overrides the default newest-first order
// (an id tiebreaker keeps paging stable); `compare`/`predicate` carry the in-memory custom-relation
// sort/emptiness paths exactly as setRecords does — complete because there is no pagination yet.
export async function objectRecords(
	spaceId: string,
	filters: Prisma.ObjWhereInput = {},
	orderBy: Prisma.ObjOrderByWithRelationInput[] = [],
	compare?:
		| ((a: Record<string, unknown>, b: Record<string, unknown>) => number)
		| null,
	predicate?: ((row: Record<string, unknown>) => boolean) | null,
) {
	let rows = await prisma.obj.findMany({
		where: {
			spaceId,
			isDeleted: false,
			...filters,
		},
		orderBy: compare
			? { id: "asc" }
			: orderBy.length > 0
				? [...orderBy, { id: "asc" }]
				: { updatedAt: "desc" },
	});

	if (predicate) {
		rows = rows.filter(predicate);
	}

	if (compare) {
		rows.sort(compare);
	}

	return rows.map(objectRecord);
}

// Anytype I.FilterCondition values for a `type.uniqueKey` filter (front_web dataview.ts:60).
const TYPE_KEY_EQUAL = 1;
const TYPE_KEY_NOT_EQUAL = 2;
const TYPE_KEY_IN = 9;
const TYPE_KEY_NOT_IN = 10;

// `type.uniqueKey` is a nested relation: an object's type is Obj.typeId -> ObjectType.uniqueKey,
// so a filter on it cannot ride the column-only translateSetFilters (which drops it). Resolve each
// such filter to the space's ObjectType ids and constrain Obj.typeId instead. Equal/In match objects
// whose type is one of the keys; NotEqual/NotIn must ALSO keep untyped objects (typeId null) — a bare
// SQL `notIn` drops nulls — so they OR in the null case. Keys matching no ObjectType resolve to an
// empty id set: Equal/In then matches nothing and NotEqual/NotIn everything, both faithful (this is
// why the widget's `type.uniqueKey NotEqual ot-template` is a correct no-op until templates exist).
// Multiple type.uniqueKey filters AND-combine. Returns {} when there are none, leaving the where untouched.
export async function typeUniqueKeyClause(
	spaceId: string,
	wireFilters: unknown,
): Promise<Prisma.ObjWhereInput> {
	if (!Array.isArray(wireFilters)) {
		return {};
	}

	const clauses: Prisma.ObjWhereInput[] = [];
	for (const raw of wireFilters) {
		if (!raw || typeof raw !== "object") {
			continue;
		}
		const filter = raw as {
			RelationKey?: unknown;
			condition?: unknown;
			value?: unknown;
		};
		if (filter.RelationKey !== "type.uniqueKey") {
			continue;
		}
		const condition =
			typeof filter.condition === "number" ? filter.condition : 0;
		const keys = (
			Array.isArray(filter.value) ? filter.value : [filter.value]
		).filter((it): it is string => typeof it === "string");
		if (keys.length === 0) {
			continue;
		}

		const types = await prisma.objectType.findMany({
			where: { spaceId, uniqueKey: { in: keys } },
			select: { id: true },
		});
		const ids = types.map((it) => it.id);

		if (condition === TYPE_KEY_EQUAL || condition === TYPE_KEY_IN) {
			clauses.push({ typeId: { in: ids } });
		} else if (
			condition === TYPE_KEY_NOT_EQUAL ||
			condition === TYPE_KEY_NOT_IN
		) {
			clauses.push({ OR: [{ typeId: null }, { typeId: { notIn: ids } }] });
		}
	}

	if (clauses.length === 0) {
		return {};
	}
	if (clauses.length === 1) {
		return clauses[0];
	}
	return { AND: clauses };
}

// Anytype I.FilterCondition values for a `targetObjectType` filter (front_web dataview.ts:60).
const TARGET_TYPE_EQUAL = 1;
const TARGET_TYPE_IN = 9;
const TARGET_OBJECT_TYPE_KEY = "targetObjectType";

// `targetObjectType` is an object relation whose value lives in the details JSONB (not a Link
// edge), so translateSetFilters drops it. The template rail (sidebar/section/type/template.tsx)
// and the dataview template selector (menu/dataview/template/list.tsx) both narrow with
// `targetObjectType In <typeId>` to list one type's templates. A template stores the value either
// as an array (TemplateCreateFromObject) or as a bare scalar (the rail's "+" -> ObjectCreate), so
// each id matches either JSON shape; `In` is an intersection test, so multiple ids OR (contains
// ANY). Returns {} when there is no such filter, leaving the where untouched.
export function targetObjectTypeClause(
	wireFilters: unknown,
): Prisma.ObjWhereInput {
	if (!Array.isArray(wireFilters)) {
		return {};
	}

	const clauses: Prisma.ObjWhereInput[] = [];
	for (const raw of wireFilters) {
		if (!raw || typeof raw !== "object") {
			continue;
		}
		const filter = raw as {
			RelationKey?: unknown;
			condition?: unknown;
			value?: unknown;
		};
		if (filter.RelationKey !== TARGET_OBJECT_TYPE_KEY) {
			continue;
		}
		const condition =
			typeof filter.condition === "number" ? filter.condition : 0;
		if (condition !== TARGET_TYPE_EQUAL && condition !== TARGET_TYPE_IN) {
			continue;
		}
		const ids = (
			Array.isArray(filter.value) ? filter.value : [filter.value]
		).filter((it): it is string => typeof it === "string");
		if (ids.length === 0) {
			continue;
		}

		const path = [TARGET_OBJECT_TYPE_KEY];
		clauses.push({
			OR: ids.flatMap((id) => [
				{ details: { path, array_contains: [id] } },
				{ details: { path, equals: id } },
			]),
		} as Prisma.ObjWhereInput);
	}

	if (clauses.length === 0) {
		return {};
	}
	if (clauses.length === 1) {
		return clauses[0];
	}
	return { AND: clauses };
}

// Hydrate the records for a known set of object ids (ObjectSubscribeIds). Scoped to the
// space so a caller cannot read another space's objects by id, and returned in the requested
// order — the client keys its detail store positionally against the ids it asked for. Ids that
// match no live object in the space are omitted rather than answered with a placeholder.
export async function subscribeIdsRecords(spaceId: string, ids: string[]) {
	if (ids.length === 0) {
		return [];
	}

	const rows = await prisma.obj.findMany({
		where: { id: { in: ids }, spaceId },
	});

	const byId = new Map(rows.map((row) => [row.id, objectRecord(row)]));
	return ids
		.map((id) => byId.get(id))
		.filter((record): record is NonNullable<typeof record> => Boolean(record));
}

// The `subSpace-<spaceId>` subscription is the store the client resolves a space's own people from:
// U.Space.getMyParticipant reads `_participant_<spaceId>_<accountId>` out of it, and isMyOwner,
// canManageInvite, canMyParticipantModerate and canMyParticipantWrite all answer false when that
// record is missing — which hides the share sheet, the member-management controls and the Bin entry.
// The same subscription carries the space's homepage object (U.Space.getDashboardObject), so the
// answer is the requested participants and the requested objects merged, in the requested order, with
// ids that match nothing in this space dropped.
export async function subSpaceRecords(spaceId: string, ids: string[]) {
	const wanted = [...new Set(ids.filter((id) => id !== ""))];
	if (wanted.length === 0) {
		return [];
	}

	const [participants, objects] = await Promise.all([
		participantRecords(spaceId),
		subscribeIdsRecords(
			spaceId,
			wanted.filter((id) => !id.startsWith("_participant_")),
		),
	]);

	const byId = new Map(
		[...participants, ...objects].map((record) => [
			record.id as string,
			record,
		]),
	);

	return wanted
		.map((id) => byId.get(id))
		.filter((record): record is NonNullable<typeof record> => Boolean(record));
}

type ObjRow = Parameters<typeof objectRecord>[0];

// The Mapper.From.ObjectInfo shape (mapper.ts:159): { id, details, snippet, hasInboundLinks }.
// `details` is the full objectRecord projection the navigation page renders (it consumes only
// item.details via S.Detail.mapper). hasInboundLinks is meaningful for the central object; a
// neighbour carries false because the page never reads a neighbour's own backlink count.
function objectInfo(row: ObjRow, hasInboundLinks: boolean) {
	return {
		id: row.id,
		details: objectRecord(row),
		snippet: row.snippet ?? "",
		hasInboundLinks,
	};
}

// Project the neighbours for a list of ids, keeping the requested order and dropping ids that
// match no live object in the space (a deleted or foreign target is simply not shown).
async function navigationNeighbours(spaceId: string, ids: string[]) {
	if (ids.length === 0) {
		return [];
	}

	const rows = await prisma.obj.findMany({
		where: { id: { in: ids }, spaceId, isDeleted: false },
	});
	const byId = new Map(rows.map((row) => [row.id, objectInfo(row, false)]));
	return ids
		.map((id) => byId.get(id))
		.filter((record): record is NonNullable<typeof record> => Boolean(record));
}

// The space an object belongs to, or null when the id is unknown. NavigationGetObjectInfoWithLinks
// carries only an objectId, so the caller resolves the space here first to authorize against it.
export async function objectSpaceId(objectId: string): Promise<string | null> {
	const row = await prisma.obj.findUnique({
		where: { id: objectId },
		select: { spaceId: true },
	});
	return row?.spaceId ?? null;
}

// The graph "navigation" answer for one object: its own record plus the objects it links out to
// and the objects that link back. Command-created object relations are not written to the Link
// table (ADR-0002) — they live in Obj.details JSONB as details[relationKey] = [targetId, ...] —
// so both directions are computed from that store over the space's object-format relations. The
// details GIN index (obj_details_gin) serves the inbound array-contains probe. Returns null when
// the object is gone.
export async function navigationObjectInfo(objectId: string) {
	const obj = await prisma.obj.findUnique({ where: { id: objectId } });
	if (!obj) {
		return null;
	}

	const relations = await prisma.relation.findMany({
		where: { spaceId: obj.spaceId, format: "object" },
		select: { uniqueKey: true },
	});
	const keys = relations.map((relation) => relation.uniqueKey);

	const details =
		obj.details &&
		typeof obj.details === "object" &&
		!Array.isArray(obj.details)
			? (obj.details as Record<string, unknown>)
			: {};

	// Outbound: this object's own object-relation targets, in stored order, deduped, self excluded.
	const outboundIds: string[] = [];
	for (const key of keys) {
		const value = details[key];
		const list = Array.isArray(value)
			? value
			: value === undefined || value === null
				? []
				: [value];
		for (const item of list) {
			if (
				typeof item === "string" &&
				item !== obj.id &&
				!outboundIds.includes(item)
			) {
				outboundIds.push(item);
			}
		}
	}
	const outbound = await navigationNeighbours(obj.spaceId, outboundIds);

	// Inbound: the space's other non-deleted objects whose object-relation list holds this id.
	let inboundRows: ObjRow[] = [];
	if (keys.length > 0) {
		inboundRows = await prisma.obj.findMany({
			where: {
				spaceId: obj.spaceId,
				isDeleted: false,
				id: { not: obj.id },
				OR: keys.map((key) => ({
					details: { path: [key], array_contains: [obj.id] },
				})),
			} as Prisma.ObjWhereInput,
			orderBy: { createdAt: "asc" },
		});
	}
	const inbound = inboundRows.map((row) => objectInfo(row, false));

	return {
		spaceId: obj.spaceId,
		object: {
			id: obj.id,
			info: objectInfo(obj, inboundRows.length > 0),
			links: { inbound, outbound },
		},
	};
}

// HistoryDiffVersions: the changed lines between two stored versions, expressed in the
// client's own event vocabulary. A changed line that still matches a live Block row (by its
// stored text) is pushed as blockSetText keyed by that real row id; whatever has no row to
// attach to collapses into one objectDetailsAmend on the object's snippet, so the response
// never invents ids the client cannot resolve.
export async function historyDiffEvents(
	spaceId: string,
	objectId: string,
	fromText: string,
	toText: string,
) {
	const before = fromText.split("\n");
	const after = toText.split("\n");

	let head = 0;
	while (
		head < before.length &&
		head < after.length &&
		before[head] === after[head]
	) {
		head += 1;
	}

	let endBefore = before.length - 1;
	let endAfter = after.length - 1;
	while (
		endBefore >= head &&
		endAfter >= head &&
		before[endBefore] === after[endAfter]
	) {
		endBefore -= 1;
		endAfter -= 1;
	}

	const oldChanged = before.slice(head, endBefore + 1);
	const newChanged = after.slice(head, endAfter + 1);
	if (oldChanged.length === 0 && newChanged.length === 0) {
		return [];
	}

	const rows = await prisma.block.findMany({
		where: { objectId },
		orderBy: { index: "asc" },
		select: { id: true, text: true },
	});

	const events: Array<Record<string, unknown>> = [];
	const claimed = new Set<string>();
	const unaligned: string[] = [];
	const pairs = Math.min(oldChanged.length, newChanged.length);

	for (let i = 0; i < pairs; i += 1) {
		const row = rows.find(
			(r) => !claimed.has(r.id) && r.text === oldChanged[i],
		);
		if (!row) {
			unaligned.push(newChanged[i]);
			continue;
		}

		claimed.add(row.id);
		events.push({
			spaceId,
			blockSetText: { id: row.id, text: { value: newChanged[i] } },
		});
	}

	for (let i = pairs; i < newChanged.length; i += 1) {
		unaligned.push(newChanged[i]);
	}

	if (unaligned.length > 0 || oldChanged.length > pairs) {
		events.push({
			spaceId,
			objectDetailsAmend: {
				id: objectId,
				subIds: [],
				details: [{ key: "snippet", value: { stringValue: toText } }],
			},
		});
	}

	return events;
}
