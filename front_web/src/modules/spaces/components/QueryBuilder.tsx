import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ObjectFilter } from "@/modules/objects/types";
import { useTranslation } from "@/shared/i18n";
import {
	clausePattern,
	clauseTerm,
	newClause,
	operatorsFor,
	type ViewQuery,
} from "../views/queryModel";
import type { ViewColumn } from "../views/viewModel";

const PRESENCE = ["empty", "notEmpty"];

/** A column the compiler can filter at all; `object` values live in Link (ADR-0002). */
function filterable(columns: ViewColumn[]) {
	return columns.filter((column) => operatorsFor(column.format).length > 0);
}

function valueText(value: unknown) {
	if (Array.isArray(value)) {
		return value.join(", ");
	}

	if (value === null || value === undefined) {
		return "";
	}

	return String(value);
}

function ClauseRow({
	clause,
	columns,
	usedKeys,
	onClause,
	onRemove,
}: {
	clause: ObjectFilter;
	columns: ViewColumn[];
	usedKeys: string[];
	onClause: (next: ObjectFilter) => void;
	onRemove: () => void;
}) {
	const { t } = useTranslation();
	// A relation appears in at most one clause: two on the same key would be an
	// `and` of one column, which the compiler allows but no reader means to write.
	const options = filterable(columns).filter(
		(column) => !usedKeys.includes(column.key) || column.key === clause.key,
	);
	const column = options.find((row) => row.key === clause.key) ?? options[0];
	const operators = operatorsFor(column.format);
	const operator = operators.includes(clause.operator)
		? clause.operator
		: operators[0];
	const contains = operator === "like" || operator === "notLike";
	const display = contains
		? clauseTerm(operator, clause.value)
		: valueText(clause.value);
	const [draft, setDraft] = useState(display);

	useEffect(() => setDraft(display), [display]);

	function commit(next: unknown) {
		onClause({ key: column.key, operator, value: next });
	}

	// Choosing a relation in a different format restarts the clause, because an
	// operator and a value that suited a number do not suit a choice.
	function chooseKey(key: string) {
		const next = options.find((row) => row.key === key);

		if (next) {
			onClause(newClause(next));
		}
	}

	function chooseOperator(next: string) {
		if (PRESENCE.includes(next)) {
			onClause({ key: column.key, operator: next as ObjectFilter["operator"] });

			return;
		}

		const asOperator = next as ObjectFilter["operator"];

		// Crossing into or out of a contains operator re-writes the operand, because
		// the stored form carries the wildcards and the editor shows the term.
		onClause({
			key: column.key,
			operator: asOperator,
			value:
				asOperator === "like" || asOperator === "notLike"
					? clausePattern(asOperator, draft)
					: clauseTerm(operator, clause.value),
		});
	}

	const valueLabel = `${t("spaces.filterValue")}: ${column.label}`;

	return (
		<div className="flex flex-wrap items-center gap-2">
			<select
				aria-label={t("spaces.filterRelation")}
				className="h-9 rounded-md border border-border bg-transparent px-2 text-sm"
				value={column.key}
				onChange={(event) => chooseKey(event.target.value)}
			>
				{options.map((row) => (
					<option key={row.key} value={row.key}>
						{row.label}
					</option>
				))}
			</select>

			<select
				aria-label={t("spaces.filterOperator")}
				className="h-9 rounded-md border border-border bg-transparent px-2 text-sm"
				value={operator}
				onChange={(event) => chooseOperator(event.target.value)}
			>
				{operators.map((row) => (
					<option key={row} value={row}>
						{row}
					</option>
				))}
			</select>

			{PRESENCE.includes(operator) ? null : column.format === "checkbox" ? (
				<select
					aria-label={valueLabel}
					className="h-9 rounded-md border border-border bg-transparent px-2 text-sm"
					value={valueText(clause.value) || "true"}
					onChange={(event) => commit(event.target.value === "true")}
				>
					<option value="true">true</option>
					<option value="false">false</option>
				</select>
			) : column.format === "select" || column.format === "multiSelect" ? (
				<Input
					aria-label={valueLabel}
					className="h-9 w-44"
					value={draft}
					placeholder={t("spaces.filterChoices")}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={() =>
						commit(
							draft
								.split(",")
								.map((row) => row.trim())
								.filter(Boolean),
						)
					}
				/>
			) : (
				<Input
					aria-label={valueLabel}
					className="h-9 w-44"
					type={column.format === "number" ? "number" : "text"}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={() =>
						commit(
							contains
								? clausePattern(operator, draft)
								: column.format === "number"
									? Number(draft)
									: draft,
						)
					}
				/>
			)}

			<Button
				type="button"
				size="sm"
				variant="ghost"
				onClick={onRemove}
				aria-label={t("spaces.removeCondition")}
			>
				×
			</Button>
		</div>
	);
}

/**
 * The query a view runs. Every clause is stated over a relation the type declares, with
 * only the operators the compiler allows for that format, so a clause the kernel would
 * answer with a 422 cannot be built here.
 */
export function QueryBuilder({
	columns,
	query,
	onChange,
}: {
	columns: ViewColumn[];
	query: ViewQuery;
	onChange: (next: ViewQuery) => void;
}) {
	const { t } = useTranslation();
	const options = filterable(columns);
	const sorts = query.sorts;
	const order = sorts[0]?.order ?? "desc";

	function replaceAt(index: number, clause: ObjectFilter) {
		const next = [...query.filters];

		next[index] = clause;
		onChange({ filters: next, sorts });
	}

	function writeSort(key: string) {
		onChange({
			filters: query.filters,
			sorts: key ? [{ key, order }] : [],
		});
	}

	return (
		<div className="mt-4 flex flex-col gap-2">
			{options.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{t("spaces.pickTypeFirst")}
				</p>
			) : (
				<>
					{query.filters.map((clause) => (
						<ClauseRow
							key={clause.key}
							clause={clause}
							columns={columns}
							usedKeys={query.filters.map((row) => row.key)}
							onClause={(next) =>
								replaceAt(
									query.filters.findIndex((row) => row.key === clause.key),
									next,
								)
							}
							onRemove={() =>
								onChange({
									filters: query.filters.filter(
										(row) => row.key !== clause.key,
									),
									sorts,
								})
							}
						/>
					))}

					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={options.length <= query.filters.length}
							onClick={() =>
								onChange({
									filters: [
										...query.filters,
										newClause(
											options.find(
												(column) =>
													!query.filters.some(
														(clause) => clause.key === column.key,
													),
											) ?? options[0],
										),
									],
									sorts,
								})
							}
						>
							{t("spaces.addCondition")}
						</Button>

						<select
							aria-label={t("spaces.sortField")}
							className="h-9 rounded-md border border-border bg-transparent px-2 text-sm"
							value={sorts[0]?.key ?? ""}
							onChange={(event) => writeSort(event.target.value)}
						>
							<option value="">{t("spaces.noSort")}</option>
							{options.map((column) => (
								<option key={column.key} value={column.key}>
									{column.label}
								</option>
							))}
						</select>

						{sorts[0] ? (
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() =>
									onChange({
										filters: query.filters,
										sorts: [
											{
												key: sorts[0].key,
												order: order === "desc" ? "asc" : "desc",
											},
										],
									})
								}
							>
								{order === "desc" ? t("spaces.sortDesc") : t("spaces.sortAsc")}
							</Button>
						) : null}
					</div>
				</>
			)}
		</div>
	);
}
