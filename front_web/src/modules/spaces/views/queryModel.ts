import type { FilterOperator, ObjectFilter } from "@/modules/objects/types";
import type { ViewSort } from "../types";
import type { ViewColumn } from "./viewModel";

export type { ViewSort };

export interface ViewQuery {
	filters: ObjectFilter[];
	sorts: ViewSort[];
}

const ORDERS: ViewSort["order"][] = ["asc", "desc"];

/**
 * Mirrors `ALLOWED_OPERATORS` in the server's compiler (objects/filters.ts). Kept here so
 * the browser never offers a clause the kernel would answer with a 422; `object` is empty
 * because those values live in Link and the compiler joins nothing yet (ADR-0002).
 */
const OPERATORS: Record<ViewColumn["format"], FilterOperator[]> = {
	text: ["equal", "notEqual", "like", "notLike", "empty", "notEmpty"],
	shortText: ["equal", "notEqual", "like", "notLike", "empty", "notEmpty"],
	longText: ["equal", "notEqual", "like", "notLike", "empty", "notEmpty"],
	number: [
		"equal",
		"notEqual",
		"greater",
		"greaterOrEqual",
		"less",
		"lessOrEqual",
		"empty",
		"notEmpty",
	],
	date: [
		"equal",
		"notEqual",
		"greater",
		"greaterOrEqual",
		"less",
		"lessOrEqual",
		"empty",
		"notEmpty",
	],
	checkbox: ["equal", "notEqual"],
	select: ["equal", "notEqual", "in", "allIn", "empty", "notEmpty"],
	multiSelect: ["equal", "notEqual", "in", "allIn", "empty", "notEmpty"],
	object: [],
};

const PRESENCE: FilterOperator[] = ["empty", "notEmpty"];
const CONTAINS: FilterOperator[] = ["like", "notLike"];

function escapePattern(term: string) {
	return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * What the reader typed, with the wrapping wildcards and the escapes removed, so a
 * stored clause can be edited again. A value that was never wrapped - hand-written, or
 * stored by an older build - reads back unchanged.
 */
export function clauseTerm(operator: FilterOperator, value: unknown): string {
	const raw = String(value ?? "");

	if (!CONTAINS.includes(operator)) {
		return raw;
	}

	const inner =
		raw.length > 1 && raw.startsWith("%") && raw.endsWith("%")
			? raw.slice(1, -1)
			: raw;

	return inner.replace(/\\([\\%_])/g, "$1");
}

/**
 * The operand the kernel binds to ILIKE. The compiler passes the value straight through
 * (`objects/filters.ts`), so the caller owns the wildcards and the term is wrapped here.
 */
export function clausePattern(
	operator: FilterOperator,
	value: unknown,
): string {
	if (!CONTAINS.includes(operator)) {
		return String(value ?? "");
	}

	const term = clauseTerm(operator, value);

	return term ? `%${escapePattern(term)}%` : "";
}

/**
 * The clauses worth sending. A text row or a choice row the reader has not filled in yet
 * asks for nothing, and sending it would filter out every object that lacks the key -
 * an empty `like` is not "anything", it is "the empty string".
 */
export function activeClauses(filters: ObjectFilter[]): ObjectFilter[] {
	return filters.filter((clause) => {
		if (PRESENCE.includes(clause.operator)) {
			return true;
		}

		if (CONTAINS.includes(clause.operator)) {
			return clauseTerm(clause.operator, clause.value) !== "";
		}

		if (Array.isArray(clause.value)) {
			return clause.value.length > 0;
		}

		return clause.value !== "" && clause.value !== undefined;
	});
}

export function operatorsFor(format: ViewColumn["format"]): FilterOperator[] {
	return OPERATORS[format] ?? [];
}

/** The starting point for a clause on this column: the operator most likely wanted. */
export function newClause(column: ViewColumn): ObjectFilter {
	const [first] = operatorsFor(column.format);

	if (column.format === "checkbox") {
		return { key: column.key, operator: "equal", value: true };
	}

	if (column.format === "select" || column.format === "multiSelect") {
		return { key: column.key, operator: "in", value: [] };
	}

	if (column.format === "number" || column.format === "date") {
		return {
			key: column.key,
			operator: "greater",
			value: column.format === "number" ? 0 : "",
		};
	}

	// A text column starts as a substring match, because that is what a reader types.
	if (
		column.format === "text" ||
		column.format === "shortText" ||
		column.format === "longText"
	) {
		return { key: column.key, operator: "like", value: "" };
	}

	return { key: column.key, operator: first ?? "equal", value: "" };
}

/**
 * Only statements the type declares and the format can use survive, so a hand-written
 * address bar or a view saved before a relation was removed still answers.
 */
export function sanitizeQuery(
	query: unknown,
	columns: ViewColumn[],
): ViewQuery {
	const byKey = new Map(columns.map((column) => [column.key, column]));
	const raw = query as { filters?: unknown; sorts?: unknown };
	const filters: ObjectFilter[] = [];

	for (const clause of Array.isArray(raw?.filters) ? raw.filters : []) {
		const candidate = clause as ObjectFilter;
		const column = byKey.get(candidate?.key);

		if (!column || !operatorsFor(column.format).includes(candidate.operator)) {
			continue;
		}

		filters.push(
			PRESENCE.includes(candidate.operator)
				? { key: candidate.key, operator: candidate.operator }
				: {
						key: candidate.key,
						operator: candidate.operator,
						value: candidate.value,
					},
		);
	}

	const sorts: ViewSort[] = [];

	for (const sort of Array.isArray(raw?.sorts) ? raw.sorts : []) {
		const candidate = sort as ViewSort;

		// A direction the compiler does not know is not a sort, so it is dropped
		// rather than guessed at.
		if (!byKey.has(candidate?.key) || !ORDERS.includes(candidate.order)) {
			continue;
		}

		sorts.push({ key: candidate.key, order: candidate.order });
	}

	return { filters, sorts };
}

// Both lists ride as JSON so a shared link keeps the query, and an empty query writes
// empty strings, which is what tells the browser to drop the params.
export function queryParams(query: ViewQuery): Record<string, string> {
	return {
		filters: query.filters.length ? JSON.stringify(query.filters) : "",
		sorts: query.sorts.length ? JSON.stringify(query.sorts) : "",
	};
}

function parseList(raw: string | null): unknown {
	if (!raw) {
		return [];
	}

	try {
		return JSON.parse(raw);
	} catch {
		return [];
	}
}

export function readQuery(
	params: URLSearchParams,
	columns: ViewColumn[],
): ViewQuery {
	return sanitizeQuery(
		{
			filters: parseList(params.get("filters")),
			sorts: parseList(params.get("sorts")),
		},
		columns,
	);
}

/**
 * The query a saved view carries. Returned as stored rather than filtered against the
 * type's current columns: the record list runs these server-side, so a relation the space
 * has since dropped has to surface as the view's own 422 (ADR-0012) instead of quietly
 * widening the view.
 */
export function storedQuery(view?: {
	details?: Record<string, unknown>;
}): ViewQuery {
	const stored = view?.details ?? {};
	const filters = Array.isArray(stored.dataviewFilters)
		? (stored.dataviewFilters as ObjectFilter[])
		: [];
	const sorts = Array.isArray(stored.dataviewSorts)
		? (stored.dataviewSorts as ViewSort[]).filter((sort) =>
				ORDERS.includes(sort.order),
			)
		: [];

	return { filters, sorts };
}
