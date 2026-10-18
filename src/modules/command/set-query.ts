import type { Prisma } from "../../generated/prisma/client.js";
import { SYSTEM_RELATIONS } from "../objects/constants.js";

// Anytype I.FilterCondition (front_web/src/ts/interface/block/dataview.ts:60). Only the
// conditions this shim translates faithfully are listed; the rest are ignored rather than
// guessed at.
const CONDITION_EQUAL = 1;
const CONDITION_NOT_EQUAL = 2;
const CONDITION_GREATER = 3;
const CONDITION_LESS = 4;
const CONDITION_GREATER_OR_EQUAL = 5;
const CONDITION_LESS_OR_EQUAL = 6;
const CONDITION_LIKE = 7;
const CONDITION_NOT_LIKE = 8;
const CONDITION_IN = 9;
const CONDITION_NOT_IN = 10;
const CONDITION_EMPTY = 11;
const CONDITION_NOT_EMPTY = 12;
const CONDITION_EXACT_IN = 15;

// Anytype I.ObjectLayout numbers (front_web/src/ts/interface/object.ts) mapped to the
// ObjectLayout enum names this kernel actually stores. A numeric layout with no name here
// is dropped: an object cannot carry a layout the schema does not model, so excluding it
// is a no-op and matching it would match nothing.
const LAYOUT_NAMES: Record<number, string[]> = {
	0: ["basic", "dataview"],
	3: ["set"],
	4: ["objectType"],
	5: ["relation"],
	14: ["collection"],
	27: ["discussion"],
};

const TEXT_FORMATS = new Set<string>(["shortText", "longText"]);
const CHECKBOX_FORMATS = new Set<string>(["checkbox"]);
const DATE_FORMATS = new Set<string>(["date"]);

// Anytype numeric RelationType for a number relation (RELATION_FORMAT in
// registry-service.ts). A custom relation is not a system column, so the only signal the
// shim has for how to compare its details-JSONB value is this wire format; number is the
// one format Prisma's JSON filter compares faithfully (gt/lt/... on a JSONB number).
const FORMAT_NUMBER = 2;
// longText(0)/shortText(1)/select(3) all store a plain string in the details JSONB, which
// Prisma's JSON filter matches faithfully with `equals`.
const FORMAT_LONG_TEXT = 0;
const FORMAT_SHORT_TEXT = 1;
const FORMAT_SELECT = 3;
// multiSelect(11) stores an ARRAY of option ids in the details JSONB, so a board column
// grouped on one tag must match every record holding that tag among others — a JSONB
// array-contains, not the exact match a single select uses.
const FORMAT_MULTI_SELECT = 11;
const CUSTOM_TEXT_FORMATS = new Set<number>([
	FORMAT_LONG_TEXT,
	FORMAT_SHORT_TEXT,
	FORMAT_SELECT,
]);

interface WireFilter {
	RelationKey?: unknown;
	format?: unknown;
	condition?: unknown;
	value?: unknown;
}

function asStringArray(value: unknown): string[] {
	const list = Array.isArray(value) ? value : [value];
	return list.filter((item): item is string => typeof item === "string");
}

function layoutNames(value: unknown): string[] {
	const list = Array.isArray(value) ? value : [value];
	const names: string[] = [];
	for (const item of list) {
		const mapped = typeof item === "number" ? LAYOUT_NAMES[item] : undefined;
		if (mapped) {
			names.push(...mapped);
		}
	}
	return names;
}

function textClause(
	field: string,
	condition: number,
	value: unknown,
): Prisma.ObjWhereInput | null {
	switch (condition) {
		case CONDITION_EQUAL:
			return { [field]: String(value) } as Prisma.ObjWhereInput;
		case CONDITION_NOT_EQUAL:
			return { NOT: { [field]: String(value) } } as Prisma.ObjWhereInput;
		case CONDITION_LIKE:
			return {
				[field]: { contains: String(value), mode: "insensitive" },
			} as Prisma.ObjWhereInput;
		case CONDITION_NOT_LIKE:
			return {
				NOT: { [field]: { contains: String(value), mode: "insensitive" } },
			} as Prisma.ObjWhereInput;
		case CONDITION_IN:
			return { [field]: { in: asStringArray(value) } } as Prisma.ObjWhereInput;
		case CONDITION_NOT_IN:
			return {
				[field]: { notIn: asStringArray(value) },
			} as Prisma.ObjWhereInput;
		case CONDITION_EMPTY:
			return {
				OR: [{ [field]: null }, { [field]: "" }],
			} as Prisma.ObjWhereInput;
		case CONDITION_NOT_EMPTY:
			return {
				NOT: { OR: [{ [field]: null }, { [field]: "" }] },
			} as Prisma.ObjWhereInput;
		default:
			return null;
	}
}

function layoutClause(
	condition: number,
	value: unknown,
): Prisma.ObjWhereInput | null {
	const names = layoutNames(value);
	if (names.length === 0) {
		return null;
	}
	switch (condition) {
		case CONDITION_EQUAL:
		case CONDITION_IN:
			return { resolvedLayout: { in: names } } as Prisma.ObjWhereInput;
		case CONDITION_NOT_EQUAL:
		case CONDITION_NOT_IN:
			return { resolvedLayout: { notIn: names } } as Prisma.ObjWhereInput;
		default:
			return null;
	}
}

// A checkbox column is Boolean? (done) or Boolean (isFavorite/isArchived/isHidden). Equal /
// NotEqual compare the boolean; Empty means unchecked (null or false, so it also matches the
// nullable `done`) and NotEmpty means checked.
function checkboxClause(
	field: string,
	condition: number,
	value: unknown,
): Prisma.ObjWhereInput | null {
	switch (condition) {
		case CONDITION_EQUAL:
			return { [field]: Boolean(value) } as Prisma.ObjWhereInput;
		case CONDITION_NOT_EQUAL:
			return { NOT: { [field]: Boolean(value) } } as Prisma.ObjWhereInput;
		case CONDITION_EMPTY:
			return {
				OR: [{ [field]: null }, { [field]: false }],
			} as Prisma.ObjWhereInput;
		case CONDITION_NOT_EMPTY:
			return { [field]: true } as Prisma.ObjWhereInput;
		default:
			return null;
	}
}

// Date values ride the wire as Unix seconds (objectRecord stores getTime()/1000). Empty /
// NotEmpty are not translated: createdAt/updatedAt are non-null columns, so an emptiness test
// cannot narrow faithfully.
function dateClause(
	field: string,
	condition: number,
	value: unknown,
): Prisma.ObjWhereInput | null {
	const seconds = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(seconds)) {
		return null;
	}
	const instant = new Date(seconds * 1000);
	switch (condition) {
		case CONDITION_GREATER:
			return { [field]: { gt: instant } } as Prisma.ObjWhereInput;
		case CONDITION_LESS:
			return { [field]: { lt: instant } } as Prisma.ObjWhereInput;
		case CONDITION_GREATER_OR_EQUAL:
			return { [field]: { gte: instant } } as Prisma.ObjWhereInput;
		case CONDITION_LESS_OR_EQUAL:
			return { [field]: { lte: instant } } as Prisma.ObjWhereInput;
		case CONDITION_EQUAL:
			return { [field]: instant } as Prisma.ObjWhereInput;
		case CONDITION_NOT_EQUAL:
			return { NOT: { [field]: instant } } as Prisma.ObjWhereInput;
		default:
			return null;
	}
}

// A custom number relation is not a column: its value lives in Obj.details JSONB, so the
// compare rides a Prisma JSON path filter. Only Equal/Greater/Less/GreaterOrEqual/
// LessOrEqual are translated; a non-numeric value or any other condition is dropped rather
// than guessed at, so the result is never narrowed incorrectly.
function customNumberClause(
	key: string,
	condition: number,
	value: unknown,
): Prisma.ObjWhereInput | null {
	if (typeof value === "string" && value.trim() === "") {
		return null;
	}
	const num = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(num)) {
		return null;
	}
	const path = [key];
	switch (condition) {
		case CONDITION_EQUAL:
			return { details: { path, equals: num } } as Prisma.ObjWhereInput;
		case CONDITION_GREATER:
			return { details: { path, gt: num } } as Prisma.ObjWhereInput;
		case CONDITION_LESS:
			return { details: { path, lt: num } } as Prisma.ObjWhereInput;
		case CONDITION_GREATER_OR_EQUAL:
			return { details: { path, gte: num } } as Prisma.ObjWhereInput;
		case CONDITION_LESS_OR_EQUAL:
			return { details: { path, lte: num } } as Prisma.ObjWhereInput;
		default:
			return null;
	}
}

// A custom text/select relation stores its value in Obj.details JSONB. Equal, In and ExactIn
// are translated (all are exact matches the JSON filter expresses faithfully); Like/NotLike
// would need a case-insensitive contains Prisma's JSON filter cannot express, and
// NotEqual/NotIn/Empty/NotEmpty have ambiguous semantics when the path is absent — all are
// dropped so the result is never narrowed incorrectly.
function customTextClause(
	key: string,
	condition: number,
	value: unknown,
): Prisma.ObjWhereInput | null {
	const path = [key];
	switch (condition) {
		case CONDITION_EQUAL:
			return {
				details: { path, equals: String(value) },
			} as Prisma.ObjWhereInput;
		case CONDITION_IN: {
			const values = asStringArray(value);
			if (values.length === 0) {
				return null;
			}
			return {
				OR: values.map((it) => ({ details: { path, equals: it } })),
			} as Prisma.ObjWhereInput;
		}
		case CONDITION_EXACT_IN: {
			const values = asStringArray(value);
			if (values.length === 0) {
				return null;
			}
			// A board column groups on one option (getGroupFilter → ExactIn with a single
			// id). The client persists a select value as a one-element array
			// (Relation.formatValue → getArrayValue) but a bare scalar is also valid, so a
			// single-option ExactIn matches either exact JSON shape. More than one option is
			// an exact array match.
			if (values.length === 1) {
				return {
					OR: [
						{ details: { path, equals: values } },
						{ details: { path, equals: values[0] } },
					],
				} as Prisma.ObjWhereInput;
			}
			return { details: { path, equals: values } } as Prisma.ObjWhereInput;
		}
		default:
			return null;
	}
}

// A custom multiSelect (tag) relation stores an ARRAY of option ids in Obj.details JSONB. A
// board column groups on one option and must match every record holding that tag among others,
// so ExactIn translates to a JSONB array-contains rather than the exact match a single select
// uses. array_contains is a subset test, so a multi-option ExactIn matches records holding all
// of them — a superset of exact set-equality, which never excludes a record the caller asked
// for. Any other condition is dropped rather than guessed at.
function customMultiSelectClause(
	key: string,
	condition: number,
	value: unknown,
): Prisma.ObjWhereInput | null {
	if (condition !== CONDITION_EXACT_IN) {
		return null;
	}
	const values = asStringArray(value);
	if (values.length === 0) {
		return null;
	}
	return {
		details: { path: [key], array_contains: values },
	} as Prisma.ObjWhereInput;
}

// Translate the Anytype wire filters (Mapper.To.Filter output) riding on a set's
// ObjectSearchSubscribe into a Prisma where fragment, AND-combined. The column-backed system
// relations (text, select/layout, checkbox, date) and custom NUMBER / TEXT / SELECT /
// MULTISELECT relations (details JSONB path) are translated; a filter on a custom relation in
// any other format, an object relation (Link), or an unhandled condition contributes no
// constraint. That is a deliberate, monotonic improvement over ignoring every filter: it never
// narrows a result set incorrectly, it just may not yet narrow it as far as the caller asked.
export function translateSetFilters(
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
		const filter = raw as WireFilter;
		const key =
			typeof filter.RelationKey === "string" ? filter.RelationKey : "";
		// A dotted RelationKey is a nested/derived relation (e.g. `type.uniqueKey`), never a
		// flat details-JSONB column. It is resolved by a dedicated clause (typeUniqueKeyClause)
		// or dropped; letting it reach the custom-relation path below would compare a details
		// key that does not exist and wrongly narrow the set to nothing.
		if (key.includes(".")) {
			continue;
		}
		const condition =
			typeof filter.condition === "number" ? filter.condition : 0;
		const definition = SYSTEM_RELATIONS[key];

		let clause: Prisma.ObjWhereInput | null;
		if (!definition) {
			// A custom relation is not a system column; only number, text/select and
			// multiSelect formats compare faithfully through the details JSONB path, so
			// anything else is dropped.
			const wireFormat = typeof filter.format === "number" ? filter.format : -1;
			if (wireFormat === FORMAT_NUMBER) {
				clause = customNumberClause(key, condition, filter.value);
			} else if (CUSTOM_TEXT_FORMATS.has(wireFormat)) {
				clause = customTextClause(key, condition, filter.value);
			} else if (wireFormat === FORMAT_MULTI_SELECT) {
				clause = customMultiSelectClause(key, condition, filter.value);
			} else {
				clause = null;
			}
		} else {
			const format = definition.format;
			if (key === "resolvedLayout") {
				clause = layoutClause(condition, filter.value);
			} else if (TEXT_FORMATS.has(format)) {
				clause = textClause(key, condition, filter.value);
			} else if (CHECKBOX_FORMATS.has(format)) {
				clause = checkboxClause(key, condition, filter.value);
			} else if (DATE_FORMATS.has(format)) {
				clause = dateClause(key, condition, filter.value);
			} else {
				clause = null;
			}
		}

		if (clause) {
			clauses.push(clause);
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

const SORT_TYPE_ASC = 0;
const SORT_TYPE_DESC = 1;

interface WireSort {
	RelationKey?: unknown;
	type?: unknown;
}

// Translate the Anytype wire sorts (Mapper.To.Sort output) riding on a set's
// ObjectSearchSubscribe into a Prisma orderBy array, preserving order. Only the column-backed
// system relations are orderable through the typed Prisma API; a Custom sort (needs Option
// entities) or a sort on a custom relation (details JSONB) contributes nothing, so the caller
// falls back to its default order.
export function translateSetSorts(
	wireSorts: unknown,
): Prisma.ObjOrderByWithRelationInput[] {
	if (!Array.isArray(wireSorts)) {
		return [];
	}

	const orderBy: Prisma.ObjOrderByWithRelationInput[] = [];
	for (const raw of wireSorts) {
		if (!raw || typeof raw !== "object") {
			continue;
		}
		const sort = raw as WireSort;
		const key = typeof sort.RelationKey === "string" ? sort.RelationKey : "";
		if (!SYSTEM_RELATIONS[key]) {
			continue;
		}

		let direction: "asc" | "desc";
		if (sort.type === SORT_TYPE_ASC) {
			direction = "asc";
		} else if (sort.type === SORT_TYPE_DESC) {
			direction = "desc";
		} else {
			continue;
		}

		orderBy.push({ [key]: direction } as Prisma.ObjOrderByWithRelationInput);
	}

	return orderBy;
}

// A sort on a custom relation cannot ride a Prisma orderBy — its value lives in the details
// JSONB, not a column — so translateSetSorts drops it and the caller falls back to its default
// order. When any custom-relation sort is present, this builds a comparator over the FULL
// ordered sort list that reads raw Obj rows uniformly: a system key off its real column, a
// custom key off details. Empties sort last regardless of direction (Anytype dataview
// behaviour) and the sort is stable, so ties keep the caller's deterministic {id:'asc'} base
// order. Returns null when no custom sort is present, leaving the efficient Prisma orderBy path
// (translateSetSorts) untouched — a monotonic improvement that never reorders a system-only sort.
export type SetSortRow = Record<string, unknown>;

function readSortValue(
	row: SetSortRow,
	key: string,
	isSystem: boolean,
): unknown {
	if (isSystem) {
		return row[key];
	}
	const details = row.details;
	if (details && typeof details === "object" && !Array.isArray(details)) {
		return (details as Record<string, unknown>)[key];
	}
	return undefined;
}

function isEmptySortValue(value: unknown): boolean {
	return (
		value === undefined ||
		value === null ||
		value === "" ||
		(Array.isArray(value) && value.length === 0)
	);
}

// A date column rides as a Date and a custom date relation as Unix seconds, so both normalise
// to a number; two numbers compare numerically, two booleans false-before-true, and anything
// else falls back to a deterministic lexicographic compare of its string form.
function compareSortValues(a: unknown, b: unknown): number {
	const left = a instanceof Date ? a.getTime() : a;
	const right = b instanceof Date ? b.getTime() : b;
	if (typeof left === "number" && typeof right === "number") {
		return left < right ? -1 : left > right ? 1 : 0;
	}
	if (typeof left === "boolean" && typeof right === "boolean") {
		return Number(left) - Number(right);
	}
	const leftText = String(left);
	const rightText = String(right);
	return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

export function setSortComparator(
	wireSorts: unknown,
): ((a: SetSortRow, b: SetSortRow) => number) | null {
	if (!Array.isArray(wireSorts)) {
		return null;
	}

	const specs: { key: string; isSystem: boolean; direction: 1 | -1 }[] = [];
	let hasCustom = false;
	for (const raw of wireSorts) {
		if (!raw || typeof raw !== "object") {
			continue;
		}
		const sort = raw as WireSort;
		const key = typeof sort.RelationKey === "string" ? sort.RelationKey : "";
		if (!key) {
			continue;
		}
		let direction: 1 | -1;
		if (sort.type === SORT_TYPE_ASC) {
			direction = 1;
		} else if (sort.type === SORT_TYPE_DESC) {
			direction = -1;
		} else {
			continue;
		}
		const isSystem = Boolean(SYSTEM_RELATIONS[key]);
		if (!isSystem) {
			hasCustom = true;
		}
		specs.push({ key, isSystem, direction });
	}

	if (!hasCustom) {
		return null;
	}

	return (a, b) => {
		for (const spec of specs) {
			const left = readSortValue(a, spec.key, spec.isSystem);
			const right = readSortValue(b, spec.key, spec.isSystem);
			const leftEmpty = isEmptySortValue(left);
			const rightEmpty = isEmptySortValue(right);
			if (leftEmpty && rightEmpty) {
				continue;
			}
			if (leftEmpty) {
				return 1;
			}
			if (rightEmpty) {
				return -1;
			}
			const result = compareSortValues(left, right);
			if (result !== 0) {
				return result * spec.direction;
			}
		}
		return 0;
	};
}

// A custom relation's emptiness cannot ride the Prisma where either: its value lives in the
// details JSONB and Prisma's typed path filter cannot test a key for absence, so
// translateSetFilters drops an Empty/NotEmpty condition on a custom key. When one is present,
// this builds an in-memory predicate over the raw Obj rows reusing the sort comparator's exact
// emptiness definition (isEmptySortValue: absent, null, "" or []). Multiple such filters
// AND-combine. Returns null when no custom Empty/NotEmpty filter is present, leaving the
// DB-side where untouched. System relations are excluded — their Empty/NotEmpty already
// translate DB-side (textClause/checkboxClause), so handling them here too would double-apply.
export type SetFilterRow = Record<string, unknown>;

export function setFilterPredicate(
	wireFilters: unknown,
): ((row: SetFilterRow) => boolean) | null {
	if (!Array.isArray(wireFilters)) {
		return null;
	}

	const specs: { key: string; wantEmpty: boolean }[] = [];
	for (const raw of wireFilters) {
		if (!raw || typeof raw !== "object") {
			continue;
		}
		const filter = raw as WireFilter;
		const key =
			typeof filter.RelationKey === "string" ? filter.RelationKey : "";
		if (!key || SYSTEM_RELATIONS[key]) {
			continue;
		}
		if (filter.condition === CONDITION_EMPTY) {
			specs.push({ key, wantEmpty: true });
		} else if (filter.condition === CONDITION_NOT_EMPTY) {
			specs.push({ key, wantEmpty: false });
		}
	}

	if (specs.length === 0) {
		return null;
	}

	return (row) =>
		specs.every((spec) => {
			const value = readSortValue(row, spec.key, false);
			return isEmptySortValue(value) === spec.wantEmpty;
		});
}
