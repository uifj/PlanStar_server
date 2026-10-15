import type { ObjectDetail } from "@/modules/objects/types";
import type { RelationFormat, SpaceRelation, SpaceType } from "../types";

export interface ViewColumn {
	key: string;
	label: string;
	format: RelationFormat | "text";
}

export interface RelationGroup {
	key: string;
	label: string;
	objects: ObjectDetail[];
}

export interface DayBucket {
	day: string;
	objects: ObjectDetail[];
}

export interface MonthBucket {
	month: string;
	days: DayBucket[];
}

const NAME_COLUMN: ViewColumn = { key: "name", label: "Name", format: "text" };

/**
 * A type's columns come from its own relations, in the order the type declares
 * them. A key the registry does not know is left out rather than rendered blank.
 */
export function columnsFor(
	type: SpaceType | undefined,
	relations: Map<string, SpaceRelation>,
): ViewColumn[] {
	const columns = [NAME_COLUMN];

	for (const key of type?.relationKeys ?? []) {
		const definition = relations.get(key);

		if (!definition) {
			continue;
		}

		columns.push({
			key,
			label: definition.name,
			format: definition.format,
		});
	}

	return columns;
}

function firstValue(object: ObjectDetail, key: string): unknown {
	const stored = object.details?.[key];

	return Array.isArray(stored) ? stored[0] : stored;
}

function values(object: ObjectDetail, key: string): unknown[] {
	const stored = object.details?.[key];

	if (stored === null || stored === undefined || stored === "") {
		return [];
	}

	return Array.isArray(stored) ? stored : [stored];
}

export function cellText(object: ObjectDetail, column: ViewColumn): string {
	if (column.key === "name") {
		return object.name;
	}

	return values(object, column.key)
		.map((value) => {
			if (column.format === "date" && typeof value === "string") {
				return Number.isNaN(Date.parse(value))
					? value
					: new Date(value).toISOString().slice(0, 10);
			}

			return value instanceof Date ? value.toISOString() : String(value);
		})
		.join(", ");
}

/** The column whose value a gallery should show, so it is not repeated as text. */
export function coverColumn(
	object: ObjectDetail,
	columns: ViewColumn[],
): ViewColumn | undefined {
	return columns.find((column) => {
		if (column.key === "name") {
			return false;
		}

		const value = firstValue(object, column.key);

		return typeof value === "string" && /^https?:\/\//.test(value);
	});
}

export function pickCover(
	object: ObjectDetail,
	columns: ViewColumn[],
	coverKey = "",
): string | undefined {
	const named = coverKey ? firstValue(object, coverKey) : undefined;

	if (typeof named === "string" && named) {
		return named;
	}

	const cover = coverColumn(object, columns);

	return cover ? (firstValue(object, cover.key) as string) : undefined;
}

export const VIEW_LAYOUTS = ["grid", "gallery", "board", "calendar"] as const;

export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

export interface ViewLayoutConfig {
	layout: ViewLayout;
	groupRelationKey: string;
	coverRelationKey: string;
}

/** A name the browser can draw; anything else is the grid. */
export function layoutNamed(value: unknown): ViewLayout {
	return (VIEW_LAYOUTS as readonly string[]).includes(String(value))
		? (String(value) as ViewLayout)
		: "grid";
}

/**
 * The layout a saved view carries (ADR-0012). A value this build cannot draw - a
 * hand-edited row or a layout from a newer build - falls back to the grid, so the
 * view still answers instead of failing on every open.
 */
export function viewLayout(view?: ObjectDetail): ViewLayoutConfig {
	const stored = (view?.details ?? {}) as Record<string, unknown>;

	function text(key: string) {
		return typeof stored[key] === "string" ? (stored[key] as string) : "";
	}

	return {
		layout: layoutNamed(stored.viewType),
		groupRelationKey: text("groupRelationKey"),
		coverRelationKey: text("coverRelationKey"),
	};
}

/** One column per choice; objects without one stay visible in their own column. */
export function groupByRelation(
	objects: ObjectDetail[],
	key: string,
): RelationGroup[] {
	const groups = new Map<string, RelationGroup>();

	for (const object of objects) {
		const choices = values(object, key).map((value) => String(value));

		for (const choice of choices.length ? choices : ["untagged"]) {
			const group = groups.get(choice) ?? {
				key: choice,
				label: choice,
				objects: [],
			};

			group.objects.push(object);
			groups.set(choice, group);
		}
	}

	return [...groups.values()];
}

/** Months and days in date order, so a planner reads top to bottom as a timeline. */
export function groupByMonth(
	objects: ObjectDetail[],
	key: string,
): MonthBucket[] {
	const months = new Map<string, Map<string, ObjectDetail[]>>();

	for (const object of objects) {
		const value = firstValue(object, key);

		if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
			continue;
		}

		const stamped = new Date(value).toISOString();
		const month = stamped.slice(0, 7);
		const day = stamped.slice(0, 10);
		const days = months.get(month) ?? new Map<string, ObjectDetail[]>();

		days.set(day, [...(days.get(day) ?? []), object]);
		months.set(month, days);
	}

	return [...months.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([month, days]) => ({
			month,
			days: [...days.entries()]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([day, objectsOnDay]) => ({ day, objects: objectsOnDay })),
		}));
}

export function objectsWithoutDate(
	objects: ObjectDetail[],
	key: string,
): ObjectDetail[] {
	return objects.filter((object) => {
		const value = firstValue(object, key);

		return typeof value !== "string" || Number.isNaN(Date.parse(value));
	});
}
