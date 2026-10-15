import { describe, expect, it } from "vitest";
import {
	activeClauses,
	clausePattern,
	clauseTerm,
	newClause,
	operatorsFor,
	queryParams,
	readQuery,
	sanitizeQuery,
	storedQuery,
	type ViewQuery,
} from "./queryModel";
import type { ViewColumn } from "./viewModel";

function column(
	key: string,
	format: ViewColumn["format"],
	label = key,
): ViewColumn {
	return { key, label, format };
}

const columns = [
	column("name", "text", "Name"),
	column("price", "number", "Price"),
	column("startDate", "date", "Start"),
	column("guests", "checkbox", "Group trip"),
	column("type", "select", "Van type"),
	column("van", "object", "Van"),
];

describe("queryModel", () => {
	it("offers only the operators the compiler allows per format", () => {
		// Arrange + assert — mirrors objects/filters.ts ALLOWED_OPERATORS
		expect(operatorsFor("number")).toEqual([
			"equal",
			"notEqual",
			"greater",
			"greaterOrEqual",
			"less",
			"lessOrEqual",
			"empty",
			"notEmpty",
		]);
		expect(operatorsFor("checkbox")).toEqual(["equal", "notEqual"]);
		// ADR-0002: object values live in Link, so nothing compiles yet
		expect(operatorsFor("object")).toEqual([]);
	});

	it("starts a clause with a usable operator and an empty value", () => {
		expect(newClause(column("name", "text"))).toEqual({
			key: "name",
			operator: "like",
			value: "",
		});
		expect(newClause(column("price", "number"))).toEqual({
			key: "price",
			operator: "greater",
			value: 0,
		});
		expect(newClause(column("startDate", "date"))).toEqual({
			key: "startDate",
			operator: "greater",
			value: "",
		});
		expect(newClause(column("guests", "checkbox"))).toEqual({
			key: "guests",
			operator: "equal",
			value: true,
		});
		// A choice relation filters over its option identifiers, comma separated
		expect(newClause(column("type", "select"))).toEqual({
			key: "type",
			operator: "in",
			value: [],
		});
	});

	it("keeps out clauses the type does not declare or the format cannot use", () => {
		// Arrange — a hand-written URL, an archived relation, a wrong operator
		const query = {
			filters: [
				{ key: "ghost", operator: "equal", value: 1 },
				{ key: "price", operator: "like", value: "89" },
				{ key: "van", operator: "equal", value: "obj-1" },
				{ key: "price", operator: "greater", value: 80 },
				{ key: "type", operator: "in", value: ["simple"] },
			],
			sorts: [
				{ key: "ghost", order: "asc" },
				{ key: "price", order: "sideways" },
				{ key: "startDate", order: "desc" },
			],
		};

		// Act
		const clean = sanitizeQuery(query, columns);

		// Assert — the two usable statements survive
		expect(clean.filters).toEqual([
			{ key: "price", operator: "greater", value: 80 },
			{ key: "type", operator: "in", value: ["simple"] },
		]);
		expect(clean.sorts).toEqual([{ key: "startDate", order: "desc" }]);
	});

	it("carries a clause with no value for the presence operators", () => {
		// Act + assert — the compiler takes no bind for empty/notEmpty
		expect(
			sanitizeQuery(
				{
					filters: [{ key: "price", operator: "notEmpty", value: 42 }],
					sorts: [],
				},
				columns,
			).filters,
		).toEqual([{ key: "price", operator: "notEmpty" }]);
	});

	it("survives a round trip through the address bar", () => {
		// Arrange
		const query: ViewQuery = {
			filters: [{ key: "price", operator: "greater", value: 80 }],
			sorts: [{ key: "startDate", order: "desc" }],
		};

		// Act
		const params = new URLSearchParams(queryParams(query));
		const read = readQuery(params, columns);

		// Assert
		expect(read).toEqual(query);
	});

	it("writes nothing when there is no query to carry", () => {
		// Act — an empty clause list must clear the params rather than pin "[]"
		expect(queryParams({ filters: [], sorts: [] })).toEqual({
			filters: "",
			sorts: "",
		});
		expect(
			readQuery(new URLSearchParams({ filters: "", sorts: "" }), columns),
		).toEqual({ filters: [], sorts: [] });
	});

	it("drops a clause list that is not shaped like JSON at all", () => {
		// Arrange — a hand-edited address bar
		const params = new URLSearchParams({ filters: "not-json", sorts: "{" });

		// Act + assert
		expect(readQuery(params, columns)).toEqual({ filters: [], sorts: [] });
	});

	it("reads the query a saved view carries", () => {
		// Arrange — exactly what the dataview service stores (ADR-0012)
		const view = {
			details: {
				viewType: "grid",
				dataviewFilters: [
					{ key: "price", operator: "greater", value: 80 },
					{ key: "type", operator: "in", value: ["simple", "rugged"] },
				],
				dataviewSorts: [{ key: "startDate", order: "asc" }],
			},
		};

		// Act + assert — kept raw, because the record list runs them server-side
		expect(storedQuery(view)).toEqual({
			filters: [
				{ key: "price", operator: "greater", value: 80 },
				{ key: "type", operator: "in", value: ["simple", "rugged"] },
			],
			sorts: [{ key: "startDate", order: "asc" }],
		});
	});

	it("answers an empty query for a view that stored none", () => {
		expect(storedQuery(undefined)).toEqual({ filters: [], sorts: [] });
		expect(storedQuery({ details: { viewType: "grid" } })).toEqual({
			filters: [],
			sorts: [],
		});
	});

	it("stores a text clause as a contains pattern and shows it back as a term", () => {
		// The kernel binds ILIKE's operand as written, so the caller owns the
		// wildcards (vanlife/service.ts does the same).
		expect(clausePattern("like", "Sierra")).toBe("%Sierra%");
		expect(clausePattern("notLike", "Sierra")).toBe("%Sierra%");
		// …and a term typed with a wildcard of its own stays literal
		expect(clausePattern("like", "100%")).toBe("%100\\%%");
		expect(clausePattern("like", "")).toBe("");

		expect(clauseTerm("like", "%Sierra%")).toBe("Sierra");
		expect(clauseTerm("like", "%100\\%%")).toBe("100%");
		// a clause stored by hand, or by an older build, still reads back
		expect(clauseTerm("like", "Sierra")).toBe("Sierra");
		expect(clauseTerm("equal", "Mammoth Lakes, CA")).toBe("Mammoth Lakes, CA");
	});

	it("drops a clause the reader has not finished filling in", () => {
		// Act — an empty text term and an empty choice list ask for nothing
		const sent = activeClauses([
			{ key: "name", operator: "like", value: "" },
			{ key: "type", operator: "in", value: [] },
			{ key: "name", operator: "like", value: "%Sierra%" },
			{ key: "price", operator: "greater", value: 80 },
			{ key: "guests", operator: "equal", value: false },
			{ key: "price", operator: "notEmpty" },
		]);

		// Assert — an absent checkbox is a real question, an absent term is not
		expect(sent).toEqual([
			{ key: "name", operator: "like", value: "%Sierra%" },
			{ key: "price", operator: "greater", value: 80 },
			{ key: "guests", operator: "equal", value: false },
			{ key: "price", operator: "notEmpty" },
		]);
	});
});
