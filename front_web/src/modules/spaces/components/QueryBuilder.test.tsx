import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LangProvider } from "@/shared/i18n";
import type { ViewQuery } from "../views/queryModel";
import type { ViewColumn } from "../views/viewModel";
import { QueryBuilder } from "./QueryBuilder";

const columns: ViewColumn[] = [
	{ key: "name", label: "Name", format: "text" },
	{ key: "price", label: "Price", format: "number" },
	{ key: "startDate", label: "Start", format: "date" },
	{ key: "guests", label: "Group trip", format: "checkbox" },
	{ key: "type", label: "Van type", format: "select" },
];

function renderBuilder(query: ViewQuery) {
	const onChange = vi.fn();

	render(
		<LangProvider>
			<QueryBuilder columns={columns} query={query} onChange={onChange} />
		</LangProvider>,
	);

	return { onChange };
}

function lastQuery(onChange: ReturnType<typeof vi.fn>): ViewQuery {
	const calls = onChange.mock.calls as unknown as [ViewQuery][];

	return calls[calls.length - 1]?.[0] as ViewQuery;
}

describe("QueryBuilder", () => {
	it("offers only the operators the relation format allows", () => {
		// Arrange
		const { onChange } = renderBuilder({
			filters: [{ key: "price", operator: "greater", value: 80 }],
			sorts: [],
		});
		const operator = screen.getByLabelText("Operator");

		// Assert — a number is never offered a substring match
		expect(
			within(operator)
				.getAllByRole("option")
				.map((option) => (option as HTMLOptionElement).value),
		).toEqual([
			"equal",
			"notEqual",
			"greater",
			"greaterOrEqual",
			"less",
			"lessOrEqual",
			"empty",
			"notEmpty",
		]);

		// Act — and a presence operator carries no value at all
		fireEvent.change(operator, { target: { value: "notEmpty" } });

		expect(lastQuery(onChange).filters).toEqual([
			{ key: "price", operator: "notEmpty" },
		]);
	});

	it("restarts a clause when the relation changes format", () => {
		// Arrange
		const { onChange } = renderBuilder({
			filters: [{ key: "price", operator: "greater", value: 80 }],
			sorts: [],
		});

		// Act — the same clause moves to a choice relation
		fireEvent.change(screen.getByLabelText("Relation"), {
			target: { value: "type" },
		});

		// Assert
		expect(lastQuery(onChange).filters).toEqual([
			{ key: "type", operator: "in", value: [] },
		]);
	});

	it("splits a choice filter on commas and keeps a text filter whole", () => {
		// Arrange
		const { onChange } = renderBuilder({
			filters: [
				{ key: "type", operator: "in", value: [] },
				{ key: "name", operator: "like", value: "" },
			],
			sorts: [],
		});

		// Act
		const choices = screen.getByLabelText("Value: Van type");

		fireEvent.change(choices, { target: { value: "simple, rugged" } });
		fireEvent.blur(choices);

		expect(lastQuery(onChange).filters[0]).toEqual({
			key: "type",
			operator: "in",
			value: ["simple", "rugged"],
		});

		// Act — a text clause is stored as a contains pattern, not as a term
		const text = screen.getByLabelText("Value: Name");

		fireEvent.change(text, { target: { value: "Sierra, Weekender" } });
		fireEvent.blur(text);

		expect(lastQuery(onChange).filters[1]).toEqual({
			key: "name",
			operator: "like",
			value: "%Sierra, Weekender%",
		});

		// …and the field shows the term back, not the wildcards it stored
		expect(text).toHaveValue("Sierra, Weekender");
	});

	it("writes a checkbox as a boolean", () => {
		// Arrange
		const { onChange } = renderBuilder({
			filters: [{ key: "guests", operator: "equal", value: true }],
			sorts: [],
		});

		// Act
		fireEvent.change(screen.getByLabelText("Value: Group trip"), {
			target: { value: "false" },
		});

		// Assert
		expect(lastQuery(onChange).filters).toEqual([
			{ key: "guests", operator: "equal", value: false },
		]);
	});

	it("removes a clause", () => {
		// Arrange
		const { onChange } = renderBuilder({
			filters: [{ key: "price", operator: "greater", value: 80 }],
			sorts: [],
		});

		// Act
		fireEvent.click(screen.getByRole("button", { name: "Remove condition" }));

		// Assert
		expect(lastQuery(onChange)).toEqual({ filters: [], sorts: [] });
	});

	it("adds a clause on the first relation the compiler can filter", () => {
		// Arrange
		const { onChange } = renderBuilder({ filters: [], sorts: [] });

		// Act
		fireEvent.click(screen.getByRole("button", { name: "Add condition" }));

		// Assert
		expect(lastQuery(onChange).filters).toEqual([
			{ key: "name", operator: "like", value: "" },
		]);
	});

	it("sorts on a declared column and flips the direction", () => {
		// Arrange
		const { onChange } = renderBuilder({
			filters: [],
			sorts: [{ key: "startDate", order: "desc" }],
		});

		// Act
		fireEvent.change(screen.getByLabelText("Sort by"), {
			target: { value: "price" },
		});

		expect(lastQuery(onChange).sorts).toEqual([
			{ key: "price", order: "desc" },
		]);

		// Act — the button says which way the sort runs and turns it over
		fireEvent.click(screen.getByRole("button", { name: "Descending" }));

		expect(lastQuery(onChange).sorts).toEqual([
			{ key: "startDate", order: "asc" },
		]);

		// Act — and no sort clears it
		fireEvent.change(screen.getByLabelText("Sort by"), {
			target: { value: "" },
		});

		expect(lastQuery(onChange).sorts).toEqual([]);
	});
});
