import { describe, expect, it } from "vitest";
import {
	compileObjectFilters,
	type RelationRegistry,
} from "../../../src/modules/objects/filters.js";

const registry: RelationRegistry = {
	budget: { format: "number" },
};

function captureError(run: () => unknown): unknown {
	try {
		run();
	} catch (error) {
		return error;
	}

	return undefined;
}

describe("compileObjectFilters", () => {
	it("rejects a relation key that is not in the registry", () => {
		// Act
		const error = captureError(() =>
			compileObjectFilters({
				registry,
				filters: [{ key: "unknownKey", operator: "equal", value: 1 }],
				sorts: [],
			}),
		);

		// Assert
		expect(error).toMatchObject({ statusCode: 422 });
	});

	it("compares a number relation with a bound numeric cast", () => {
		// Act
		const compiled = compileObjectFilters({
			registry,
			filters: [{ key: "budget", operator: "greater", value: 100 }],
			sorts: [],
		});

		// Assert
		expect(compiled.where).toBe(
			"(o.details ->> $1::text)::numeric > $2::numeric",
		);
		expect(compiled.params).toEqual(["budget", 100]);
	});

	it("matches a select relation with jsonb containment", () => {
		// Act
		const compiled = compileObjectFilters({
			registry: { status: { format: "select" } },
			filters: [{ key: "status", operator: "equal", value: "option-a" }],
			sorts: [],
		});

		// Assert
		expect(compiled.where).toBe(
			"o.details @> jsonb_build_object($1::text, jsonb_build_array($2::text))",
		);
		expect(compiled.params).toEqual(["status", "option-a"]);
	});

	it("requires every value of an allIn multi-select filter", () => {
		// Act
		const compiled = compileObjectFilters({
			registry: { tags: { format: "multiSelect" } },
			filters: [{ key: "tags", operator: "allIn", value: ["a", "b"] }],
			sorts: [],
		});

		// Assert
		expect(compiled.where).toBe(
			"(o.details @> jsonb_build_object($1::text, jsonb_build_array($2::text)) AND " +
				"o.details @> jsonb_build_object($1::text, jsonb_build_array($3::text)))",
		);
		expect(compiled.params).toEqual(["tags", "a", "b"]);
	});

	it("rejects an operator the relation format does not support", () => {
		// Act
		const error = captureError(() =>
			compileObjectFilters({
				registry: { title: { format: "shortText" } },
				filters: [{ key: "title", operator: "greater", value: "a" }],
				sorts: [],
			}),
		);

		// Assert
		expect(error).toMatchObject({ statusCode: 422 });
	});

	it("compares a column-backed relation against the column", () => {
		// Act
		const compiled = compileObjectFilters({
			registry: { name: { format: "shortText", column: 'o."name"' } },
			filters: [{ key: "name", operator: "like", value: "van" }],
			sorts: [],
		});

		// Assert
		expect(compiled.where).toBe('o."name" ILIKE $1::text');
		expect(compiled.params).toEqual(["van"]);
	});

	it("joins a nested group with its own conjunction", () => {
		// Act
		const compiled = compileObjectFilters({
			registry,
			filters: [
				{ key: "budget", operator: "greater", value: 100 },
				{
					conjunction: "or",
					filters: [
						{ key: "budget", operator: "less", value: 10 },
						{ key: "budget", operator: "lessOrEqual", value: 20 },
					],
				},
			],
			sorts: [],
		});

		// Assert
		expect(compiled.where).toBe(
			"(o.details ->> $1::text)::numeric > $2::numeric AND " +
				"((o.details ->> $3::text)::numeric < $4::numeric OR " +
				"(o.details ->> $5::text)::numeric <= $6::numeric)",
		);
		expect(compiled.params).toEqual([
			"budget",
			100,
			"budget",
			10,
			"budget",
			20,
		]);
	});

	it("rejects filter groups nested deeper than the supported depth", () => {
		// Act
		const error = captureError(() =>
			compileObjectFilters({
				registry,
				filters: [
					{
						conjunction: "and",
						filters: [
							{
								conjunction: "and",
								filters: [
									{
										conjunction: "and",
										filters: [
											{
												conjunction: "and",
												filters: [
													{ key: "budget", operator: "equal", value: 1 },
												],
											},
										],
									},
								],
							},
						],
					},
				],
				sorts: [],
			}),
		);

		// Assert
		expect(error).toMatchObject({ statusCode: 422 });
	});

	it("sorts by a relation with the same typed access", () => {
		// Act
		const compiled = compileObjectFilters({
			registry,
			filters: [],
			sorts: [{ key: "budget", order: "desc" }],
		});

		// Assert
		expect(compiled.orderBy).toBe(
			"(o.details ->> $1::text)::numeric DESC NULLS LAST",
		);
		expect(compiled.params).toEqual(["budget"]);
	});

	it("keeps placeholder numbering continuous across filters and sorts", () => {
		// Act
		const compiled = compileObjectFilters({
			registry,
			filters: [{ key: "budget", operator: "greater", value: 100 }],
			sorts: [{ key: "budget", order: "asc" }],
		});

		// Assert
		expect(compiled.orderBy).toBe(
			"(o.details ->> $3::text)::numeric ASC NULLS LAST",
		);
		expect(compiled.params).toEqual(["budget", 100, "budget"]);
	});
});
