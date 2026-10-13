import { ValidationError } from "../../errors/http-errors.js";
import type { RelationFormat } from "../../generated/prisma/enums.js";

export const FILTER_OPERATORS = [
	"equal",
	"notEqual",
	"greater",
	"greaterOrEqual",
	"less",
	"lessOrEqual",
	"like",
	"notLike",
	"in",
	"allIn",
	"empty",
	"notEmpty",
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface RelationDefinition {
	format: RelationFormat;
	column?: string;
	maxCount?: number | null;
}

export type RelationRegistry = Record<string, RelationDefinition>;

export interface ObjectFilterCondition {
	key: string;
	operator: FilterOperator;
	value?: unknown;
}

export interface ObjectFilterGroup {
	conjunction: "and" | "or";
	filters: ObjectFilterInput[];
}

export type ObjectFilterInput = ObjectFilterCondition | ObjectFilterGroup;

export interface ObjectSortInput {
	key: string;
	order: "asc" | "desc";
}

export interface CompiledObjectFilters {
	where: string;
	params: unknown[];
	orderBy: string;
}

export const MAX_FILTER_DEPTH = 3;

const COMPARISON_SQL: Partial<Record<FilterOperator, string>> = {
	equal: "=",
	notEqual: "<>",
	greater: ">",
	greaterOrEqual: ">=",
	less: "<",
	lessOrEqual: "<=",
	like: "ILIKE",
	notLike: "NOT ILIKE",
};

const SCALAR_CAST: Partial<Record<RelationFormat, string>> = {
	shortText: "text",
	longText: "text",
	number: "numeric",
	date: "timestamptz",
	checkbox: "boolean",
};

const ARRAY_FORMATS = new Set<RelationFormat>([
	"select",
	"multiSelect",
	"object",
]);

const ALLOWED_OPERATORS: Record<RelationFormat, FilterOperator[]> = {
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
	object: ["equal", "notEqual", "in", "allIn", "empty", "notEmpty"],
};

function bind(params: unknown[], value: unknown): number {
	params.push(value);

	return params.length;
}

function requireDefinition(
	registry: RelationRegistry,
	key: string,
): RelationDefinition {
	const definition = registry[key];

	if (!definition) {
		throw new ValidationError(`Unknown relation: ${key}`);
	}

	return definition;
}

function assertOperatorAllowed(
	format: RelationFormat,
	operator: FilterOperator,
	key: string,
) {
	if (!ALLOWED_OPERATORS[format].includes(operator)) {
		throw new ValidationError(
			`Operator ${operator} is not supported for relation ${key}.`,
		);
	}
}

function valueList(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [value];
}

function comparisonFor(operator: FilterOperator): string {
	const comparison = COMPARISON_SQL[operator];

	if (!comparison) {
		throw new ValidationError(`Unsupported operator: ${operator}`);
	}

	return comparison;
}

function compileContainment(
	filter: ObjectFilterCondition,
	params: unknown[],
): string {
	const keyIndex = bind(params, filter.key);
	const fragments = valueList(filter.value).map((value) => {
		const valueIndex = bind(params, value);

		return `o.details @> jsonb_build_object($${keyIndex}::text, jsonb_build_array($${valueIndex}::text))`;
	});

	if (fragments.length > 1) {
		const joiner = filter.operator === "allIn" ? " AND " : " OR ";

		return `(${fragments.join(joiner)})`;
	}

	const single = fragments[0];

	return filter.operator === "notEqual" ? `NOT (${single})` : single;
}

function compileDetailPresence(
	filter: ObjectFilterCondition,
	params: unknown[],
	present: boolean,
): string {
	const keyIndex = bind(params, filter.key);
	const expression = `(o.details -> $${keyIndex}::text IS NULL OR (o.details -> $${keyIndex}::text) = '[]'::jsonb OR (o.details ->> $${keyIndex}::text) = '')`;

	return present ? `NOT ${expression}` : expression;
}

function compileDetailCondition(
	definition: RelationDefinition,
	filter: ObjectFilterCondition,
	params: unknown[],
): string {
	if (filter.operator === "empty" || filter.operator === "notEmpty") {
		return compileDetailPresence(
			filter,
			params,
			filter.operator === "notEmpty",
		);
	}

	if (ARRAY_FORMATS.has(definition.format)) {
		return compileContainment(filter, params);
	}

	const cast = SCALAR_CAST[definition.format];
	const keyIndex = bind(params, filter.key);
	const valueIndex = bind(params, filter.value);

	return `(o.details ->> $${keyIndex}::text)::${cast} ${comparisonFor(filter.operator)} $${valueIndex}::${cast}`;
}

function compileColumnCondition(
	definition: { column: string; format: RelationFormat },
	filter: ObjectFilterCondition,
	params: unknown[],
): string {
	const { column } = definition;

	if (filter.operator === "empty" || filter.operator === "notEmpty") {
		return `${column} IS ${filter.operator === "notEmpty" ? "NOT " : ""}NULL`;
	}

	const cast = SCALAR_CAST[definition.format] ?? "text";
	const valueIndex = bind(params, filter.value);

	return `${column} ${comparisonFor(filter.operator)} $${valueIndex}::${cast}`;
}

function isFilterGroup(node: ObjectFilterInput): node is ObjectFilterGroup {
	return "conjunction" in node;
}

function compileCondition(
	registry: RelationRegistry,
	filter: ObjectFilterCondition,
	params: unknown[],
): string {
	const definition = requireDefinition(registry, filter.key);

	assertOperatorAllowed(definition.format, filter.operator, filter.key);

	const column = definition.column;

	if (column) {
		return compileColumnCondition(
			{ column, format: definition.format },
			filter,
			params,
		);
	}

	return compileDetailCondition(definition, filter, params);
}

function compileNode(
	registry: RelationRegistry,
	node: ObjectFilterInput,
	depth: number,
	params: unknown[],
): string {
	if (!isFilterGroup(node)) {
		return compileCondition(registry, node, params);
	}

	if (depth + 1 > MAX_FILTER_DEPTH) {
		throw new ValidationError(
			`Filters may not nest deeper than ${MAX_FILTER_DEPTH}.`,
		);
	}

	return `(${compileList(registry, node.filters, node.conjunction, depth + 1, params)})`;
}

function compileList(
	registry: RelationRegistry,
	nodes: ObjectFilterInput[],
	conjunction: "and" | "or",
	depth: number,
	params: unknown[],
): string {
	return nodes
		.map((node) => compileNode(registry, node, depth, params))
		.filter(Boolean)
		.join(` ${conjunction.toUpperCase()} `);
}

function compileSort(
	registry: RelationRegistry,
	sort: ObjectSortInput,
	params: unknown[],
): string {
	const definition = requireDefinition(registry, sort.key);
	const direction = sort.order.toUpperCase();

	if (definition.column) {
		return `${definition.column} ${direction}`;
	}

	if (ARRAY_FORMATS.has(definition.format)) {
		throw new ValidationError(
			`Sorting by ${sort.key} is not supported for its format.`,
		);
	}

	const keyIndex = bind(params, sort.key);

	return `(o.details ->> $${keyIndex}::text)::${SCALAR_CAST[definition.format]} ${direction} NULLS LAST`;
}

export function compileObjectFilters(input: {
	registry: RelationRegistry;
	filters: ObjectFilterInput[];
	sorts: ObjectSortInput[];
}): CompiledObjectFilters {
	const params: unknown[] = [];
	const where = compileList(input.registry, input.filters, "and", 1, params);
	const orderBy = input.sorts
		.map((sort) => compileSort(input.registry, sort, params))
		.join(", ");

	return { where, params, orderBy };
}
