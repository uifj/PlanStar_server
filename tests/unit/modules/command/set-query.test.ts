import { describe, expect, it } from "vitest";
import {
	translateSetFilters,
	translateSetSorts,
} from "../../../../src/modules/command/set-query.js";

// The Anytype client sends each filter as Mapper.To.Filter output: RelationKey (capital R),
// a numeric FilterCondition (interface/block/dataview.ts:60) and a raw JS value (Encode.value
// is an identity operation under ts-proto, struct.ts:55). translateSetFilters is the shim's
// anti-corruption layer: it maps the column-backed system relations (text, select/layout,
// checkbox, date) to a Prisma where fragment and ignores anything it cannot faithfully
// translate (custom relations in details JSONB, object relations in Link, number compare)
// rather than guessing.
describe("translateSetFilters", () => {
	it("maps an Equal condition on a text relation to a field match", () => {
		expect(
			translateSetFilters([
				{ RelationKey: "name", condition: 1, value: "Alpha" },
			]),
		).toEqual({ name: "Alpha" });
	});

	it("maps Like to a case-insensitive contains", () => {
		expect(
			translateSetFilters([
				{ RelationKey: "name", condition: 7, value: "alp" },
			]),
		).toEqual({ name: { contains: "alp", mode: "insensitive" } });
	});

	it("maps NotLike to a negated contains", () => {
		expect(
			translateSetFilters([
				{ RelationKey: "snippet", condition: 8, value: "draft" },
			]),
		).toEqual({
			NOT: { snippet: { contains: "draft", mode: "insensitive" } },
		});
	});

	it("maps NotEqual to a negated match", () => {
		expect(
			translateSetFilters([
				{ RelationKey: "name", condition: 2, value: "Beta" },
			]),
		).toEqual({ NOT: { name: "Beta" } });
	});

	it("maps In and NotIn on a text relation", () => {
		expect(
			translateSetFilters([
				{ RelationKey: "typeId", condition: 9, value: ["a", "b"] },
			]),
		).toEqual({ typeId: { in: ["a", "b"] } });
		expect(
			translateSetFilters([
				{ RelationKey: "typeId", condition: 10, value: ["a"] },
			]),
		).toEqual({ typeId: { notIn: ["a"] } });
	});

	it("maps Empty and NotEmpty to null-or-blank tests", () => {
		expect(
			translateSetFilters([{ RelationKey: "description", condition: 11 }]),
		).toEqual({ OR: [{ description: null }, { description: "" }] });
		expect(
			translateSetFilters([{ RelationKey: "description", condition: 12 }]),
		).toEqual({ NOT: { OR: [{ description: null }, { description: "" }] } });
	});

	it("maps a resolvedLayout NotIn from numeric layouts to enum names", () => {
		// The client always sends resolvedLayout NotIn excludeFromSet() on a set subscribe;
		// Set=3 and Collection=14 are the layouts that exist here.
		expect(
			translateSetFilters([
				{ RelationKey: "resolvedLayout", condition: 10, value: [3, 14] },
			]),
		).toEqual({ resolvedLayout: { notIn: ["set", "collection"] } });
	});

	it("drops a resolvedLayout filter whose numeric layouts are all unknown", () => {
		expect(
			translateSetFilters([
				{ RelationKey: "resolvedLayout", condition: 10, value: [999] },
			]),
		).toEqual({});
	});

	it("AND-combines multiple translatable filters", () => {
		expect(
			translateSetFilters([
				{ RelationKey: "name", condition: 7, value: "note" },
				{ RelationKey: "resolvedLayout", condition: 10, value: [3] },
			]),
		).toEqual({
			AND: [
				{ name: { contains: "note", mode: "insensitive" } },
				{ resolvedLayout: { notIn: ["set"] } },
			],
		});
	});

	it("maps a checkbox Equal and NotEqual to a boolean match", () => {
		expect(
			translateSetFilters([{ RelationKey: "done", condition: 1, value: true }]),
		).toEqual({ done: true });
		expect(
			translateSetFilters([
				{ RelationKey: "isFavorite", condition: 2, value: true },
			]),
		).toEqual({ NOT: { isFavorite: true } });
	});

	it("maps a checkbox Empty and NotEmpty to unchecked and checked", () => {
		// `done` is nullable, so unchecked means null-or-false; checked means true.
		expect(
			translateSetFilters([{ RelationKey: "done", condition: 11 }]),
		).toEqual({ OR: [{ done: null }, { done: false }] });
		expect(
			translateSetFilters([{ RelationKey: "done", condition: 12 }]),
		).toEqual({ done: true });
	});

	it("maps a date Greater/Less to an instant built from Unix seconds", () => {
		// The wire carries date values as Unix seconds (objectRecord divides getTime() by 1000).
		const seconds = 1_700_000_000;
		const instant = new Date(seconds * 1000);
		expect(
			translateSetFilters([
				{ RelationKey: "createdAt", condition: 3, value: seconds },
			]),
		).toEqual({ createdAt: { gt: instant } });
		expect(
			translateSetFilters([
				{ RelationKey: "updatedAt", condition: 4, value: seconds },
			]),
		).toEqual({ updatedAt: { lt: instant } });
		expect(
			translateSetFilters([
				{ RelationKey: "createdAt", condition: 5, value: seconds },
			]),
		).toEqual({ createdAt: { gte: instant } });
		expect(
			translateSetFilters([
				{ RelationKey: "createdAt", condition: 6, value: seconds },
			]),
		).toEqual({ createdAt: { lte: instant } });
	});

	it("ignores Empty/NotEmpty on an always-set date column", () => {
		// createdAt/updatedAt are non-null, so an emptiness test cannot narrow faithfully.
		expect(
			translateSetFilters([{ RelationKey: "createdAt", condition: 11 }]),
		).toEqual({});
		expect(
			translateSetFilters([{ RelationKey: "createdAt", condition: 12 }]),
		).toEqual({});
	});

	it("ignores a custom relation and an unhandled condition", () => {
		// customKey carries no wire format, so the shim cannot tell how to compare it and
		// drops it; Greater(3) on a text relation is likewise unhandled — neither narrows.
		expect(
			translateSetFilters([
				{ RelationKey: "customKey", condition: 1, value: "x" },
				{ RelationKey: "name", condition: 3, value: "x" },
			]),
		).toEqual({});
	});

	it("maps a number custom relation Greater to a details JSONB path compare", () => {
		// A custom relation is not a system column; its value lives in Obj.details JSONB and
		// its wire format (2 === number, RELATION_FORMAT) tells the shim to compare numerically.
		expect(
			translateSetFilters([
				{ RelationKey: "price", format: 2, condition: 3, value: 100 },
			]),
		).toEqual({ details: { path: ["price"], gt: 100 } });
	});

	it("maps number custom relation Equal/Less/GreaterOrEqual/LessOrEqual", () => {
		expect(
			translateSetFilters([
				{ RelationKey: "price", format: 2, condition: 1, value: 100 },
			]),
		).toEqual({ details: { path: ["price"], equals: 100 } });
		expect(
			translateSetFilters([
				{ RelationKey: "price", format: 2, condition: 4, value: 100 },
			]),
		).toEqual({ details: { path: ["price"], lt: 100 } });
		expect(
			translateSetFilters([
				{ RelationKey: "price", format: 2, condition: 5, value: 100 },
			]),
		).toEqual({ details: { path: ["price"], gte: 100 } });
		expect(
			translateSetFilters([
				{ RelationKey: "price", format: 2, condition: 6, value: 100 },
			]),
		).toEqual({ details: { path: ["price"], lte: 100 } });
	});

	it("coerces a numeric-string value and drops a non-numeric one", () => {
		expect(
			translateSetFilters([
				{ RelationKey: "price", format: 2, condition: 3, value: "250" },
			]),
		).toEqual({ details: { path: ["price"], gt: 250 } });
		expect(
			translateSetFilters([
				{ RelationKey: "price", format: 2, condition: 3, value: "cheap" },
			]),
		).toEqual({});
	});

	it("drops a custom relation in a format it cannot compare faithfully", () => {
		// A custom text relation (format 1) would need a case-insensitive contains that the
		// Prisma JSON filter cannot express, and an unhandled condition (Like on a number) is
		// not guessed at — both are dropped so the result is never narrowed incorrectly.
		expect(
			translateSetFilters([
				{ RelationKey: "status", format: 1, condition: 7, value: "avail" },
			]),
		).toEqual({});
		expect(
			translateSetFilters([
				{ RelationKey: "price", format: 2, condition: 7, value: 100 },
			]),
		).toEqual({});
	});

	it("maps a custom select/text Equal to a details JSONB path equals", () => {
		// select === format 3, shortText === format 1; both store a plain string in details.
		expect(
			translateSetFilters([
				{ RelationKey: "status", format: 3, condition: 1, value: "available" },
			]),
		).toEqual({ details: { path: ["status"], equals: "available" } });
		expect(
			translateSetFilters([
				{ RelationKey: "sku", format: 1, condition: 1, value: "A-1" },
			]),
		).toEqual({ details: { path: ["sku"], equals: "A-1" } });
	});

	it("maps a custom select In to an OR of JSONB path equals", () => {
		expect(
			translateSetFilters([
				{
					RelationKey: "status",
					format: 3,
					condition: 9,
					value: ["available", "reserved"],
				},
			]),
		).toEqual({
			OR: [
				{ details: { path: ["status"], equals: "available" } },
				{ details: { path: ["status"], equals: "reserved" } },
			],
		});
	});

	it("maps a single-option ExactIn to match either array or scalar storage", () => {
		// A board column fetches its records with getGroupFilter → ExactIn(15) carrying the
		// one option id (dataview.ts:538). The client persists a select value as an array
		// (Relation.formatValue → getArrayValue) but a scalar is also valid, so the column
		// matches either exact JSON shape for the single option.
		expect(
			translateSetFilters([
				{
					RelationKey: "status",
					format: 3,
					condition: 15,
					value: ["opt-available"],
				},
			]),
		).toEqual({
			OR: [
				{ details: { path: ["status"], equals: ["opt-available"] } },
				{ details: { path: ["status"], equals: "opt-available" } },
			],
		});
	});

	it("maps a multi-option ExactIn to an exact JSONB array match", () => {
		expect(
			translateSetFilters([
				{
					RelationKey: "status",
					format: 3,
					condition: 15,
					value: ["a", "b"],
				},
			]),
		).toEqual({ details: { path: ["status"], equals: ["a", "b"] } });
	});

	it("drops an ExactIn with no values", () => {
		expect(
			translateSetFilters([
				{ RelationKey: "status", format: 3, condition: 15, value: [] },
			]),
		).toEqual({});
	});

	it("drops a custom text/select condition it cannot compare faithfully", () => {
		// Like(7) needs a case-insensitive contains the JSON filter cannot express;
		// NotEqual(2)/Empty(11) have ambiguous null semantics on a missing JSON path —
		// all are dropped so the result is never narrowed incorrectly.
		expect(
			translateSetFilters([
				{ RelationKey: "status", format: 3, condition: 2, value: "sold" },
			]),
		).toEqual({});
		expect(
			translateSetFilters([
				{ RelationKey: "status", format: 3, condition: 11, value: "" },
			]),
		).toEqual({});
		expect(
			translateSetFilters([
				{ RelationKey: "status", format: 3, condition: 9, value: [] },
			]),
		).toEqual({});
	});

	it("maps a multiSelect ExactIn to a JSONB array-contains", () => {
		// A board column grouped on a tag relation must match every record holding that
		// tag among others, so ExactIn(15) on format 11 is an array-contains, not the
		// exact match a single select uses.
		expect(
			translateSetFilters([
				{ RelationKey: "tags", format: 11, condition: 15, value: ["a"] },
			]),
		).toEqual({ details: { path: ["tags"], array_contains: ["a"] } });
	});

	it("drops a multiSelect condition other than ExactIn", () => {
		// Equal/In on an array-valued tag have no faithful single translation, so they are
		// dropped rather than guessed at.
		expect(
			translateSetFilters([
				{ RelationKey: "tags", format: 11, condition: 1, value: "a" },
			]),
		).toEqual({});
		expect(
			translateSetFilters([
				{ RelationKey: "tags", format: 11, condition: 15, value: [] },
			]),
		).toEqual({});
	});

	it("AND-combines a custom number filter with a system filter", () => {
		expect(
			translateSetFilters([
				{ RelationKey: "name", condition: 1, value: "Van" },
				{ RelationKey: "price", format: 2, condition: 3, value: 100 },
			]),
		).toEqual({
			AND: [{ name: "Van" }, { details: { path: ["price"], gt: 100 } }],
		});
	});

	it("returns an empty fragment for a non-array input", () => {
		expect(translateSetFilters(undefined)).toEqual({});
	});
});

// Anytype Mapper.To.Sort wire shape (mapper.ts:1245): { RelationKey, type (SortType
// interface/block/dataview.ts:42 Asc=0, Desc=1, Custom=2), format, customOrder,
// emptyPlacement }. translateSetSorts maps the column-backed system relations to a Prisma
// orderBy array and ignores anything it cannot order faithfully.
describe("translateSetSorts", () => {
	it("maps an Asc sort on a column relation", () => {
		expect(translateSetSorts([{ RelationKey: "name", type: 0 }])).toEqual([
			{ name: "asc" },
		]);
	});

	it("maps a Desc sort on a date relation", () => {
		expect(translateSetSorts([{ RelationKey: "createdAt", type: 1 }])).toEqual([
			{ createdAt: "desc" },
		]);
	});

	it("preserves the order of multiple sorts", () => {
		expect(
			translateSetSorts([
				{ RelationKey: "resolvedLayout", type: 0 },
				{ RelationKey: "updatedAt", type: 1 },
			]),
		).toEqual([{ resolvedLayout: "asc" }, { updatedAt: "desc" }]);
	});

	it("ignores a Custom sort, an unknown relation and a non-array", () => {
		// Custom(2) needs Option entities, customKey lives in details JSONB — neither is
		// orderable through the typed Prisma API, so neither constrains the order.
		expect(translateSetSorts([{ RelationKey: "done", type: 2 }])).toEqual([]);
		expect(translateSetSorts([{ RelationKey: "customKey", type: 0 }])).toEqual(
			[],
		);
		expect(translateSetSorts(undefined)).toEqual([]);
	});
});
