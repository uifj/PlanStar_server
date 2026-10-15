import { describe, expect, it } from "vitest";
import type { ObjectDetail } from "@/modules/objects/types";
import type { SpaceRelation, SpaceType } from "../types";
import {
	cellText,
	columnsFor,
	groupByMonth,
	groupByRelation,
	pickCover,
	type ViewColumn,
	viewLayout,
} from "./viewModel";

function relation(
	uniqueKey: string,
	format: SpaceRelation["format"],
	name = uniqueKey,
): SpaceRelation {
	return {
		id: `r-${uniqueKey}`,
		spaceId: "space-1",
		typeId: "type-1",
		uniqueKey,
		format,
		name,
		description: null,
		isReadOnly: false,
		isHidden: false,
		maxCount: null,
	};
}

function detail(
	id: string,
	name: string,
	details: Record<string, unknown> = {},
): ObjectDetail {
	return {
		id,
		spaceId: "space-1",
		typeId: "type-1",
		layout: null,
		resolvedLayout: "basic",
		name,
		description: null,
		snippet: null,
		iconEmoji: null,
		details,
		isArchived: false,
		isDeleted: false,
		isHidden: false,
		isFavorite: false,
		done: null,
		creatorId: "user-1",
		createdAt: "2026-10-01T00:00:00.000Z",
		updatedAt: "2026-10-01T00:00:00.000Z",
	};
}

const relations = new Map<string, SpaceRelation>([
	["location", relation("location", "shortText", "Location")],
	["imageUrl", relation("imageUrl", "shortText", "Image")],
	["price", relation("price", "number", "Price per night")],
	["type", relation("type", "select", "Van type")],
	["amenities", relation("amenities", "multiSelect", "Amenities")],
	["startDate", relation("startDate", "date", "Start date")],
]);

const vanType: SpaceType = {
	id: "type-1",
	spaceId: "space-1",
	uniqueKey: "van",
	name: "Van",
	description: null,
	iconEmoji: "🚐",
	layout: "basic",
	relationKeys: ["location", "imageUrl", "price", "type", "amenities"],
};

describe("the space browser's view model", () => {
	it("builds columns from the type's own relations, name first", () => {
		// Act
		const columns = columnsFor(vanType, relations);

		// Assert — a key the registry does not know is dropped, not rendered blank
		expect(columns.map((c) => c.key)).toEqual([
			"name",
			"location",
			"imageUrl",
			"price",
			"type",
			"amenities",
		]);
		expect(columns[3]).toEqual({
			key: "price",
			label: "Price per night",
			format: "number",
		});
	});

	it("reads the first stored value whatever shape it arrived in", () => {
		// Arrange — choices are arrays here and a scalar there (ADR-0004)
		const van = detail("v-1", "Sierra", {
			price: 89,
			type: ["simple"],
			amenities: ["heater", "solar"],
			startDate: "2026-11-23T00:00:00.000Z",
		});
		const columns = columnsFor(
			{ ...vanType, relationKeys: [...vanType.relationKeys, "startDate"] },
			relations,
		);
		const column = (key: string) =>
			columns.find((c) => c.key === key) as ViewColumn;

		// Act + Assert — a date is a day, not a timestamp
		expect(cellText(van, column("startDate"))).toBe("2026-11-23");
		expect(cellText(van, column("amenities"))).toBe("heater, solar");
		expect(pickCover(van, columnsFor(vanType, relations))).toBeUndefined();
		expect(groupByRelation([van], "type")).toEqual([
			{ key: "simple", label: "simple", objects: [van] },
		]);
	});

	it("uses the first image-looking value as a gallery cover", () => {
		// Arrange
		const van = detail("v-1", "Sierra", {
			imageUrl: "https://images.example.test/sierra.jpg",
			location: "Mammoth Lakes, CA",
		});

		// Act + Assert
		expect(pickCover(van, columnsFor(vanType, relations))).toBe(
			"https://images.example.test/sierra.jpg",
		);
	});

	it("keeps untagged objects visible in their own column", () => {
		// Arrange
		const tagged = detail("v-1", "Moab", { type: ["rugged"] });
		const untagged = detail("v-2", "No type yet");

		// Act
		const groups = groupByRelation([tagged, untagged], "type");

		// Assert
		expect(groups.map((g) => g.key)).toEqual(["rugged", "untagged"]);
		expect(groups[1]?.objects.map((o) => o.name)).toEqual(["No type yet"]);
	});

	it("buckets dates by month, then by day inside it", () => {
		// Arrange
		const trips = [
			detail("b-1", "Autumn", { startDate: "2026-11-23T00:00:00.000Z" }),
			detail("b-2", "Late autumn", { startDate: "2026-11-02T00:00:00.000Z" }),
			detail("b-3", "Winter", { startDate: "2026-12-05T00:00:00.000Z" }),
			detail("b-4", "No date"),
		];

		// Act
		const months = groupByMonth(trips, "startDate");

		// Assert — newest month first is not the point; chronological order is
		expect(months.map((m) => m.month)).toEqual(["2026-11", "2026-12"]);
		expect(months[0]?.days.map((d) => d.day)).toEqual([
			"2026-11-02",
			"2026-11-23",
		]);
		expect(months[1]?.days[0]?.objects.map((o) => o.name)).toEqual(["Winter"]);
	});

	it("reads the layout and its relations off the saved view", () => {
		// Arrange
		const view = detail("dv-1", "By kind", {
			viewType: "board",
			groupRelationKey: "type",
			coverRelationKey: "imageUrl",
		});

		// Act + Assert
		expect(viewLayout(view)).toEqual({
			layout: "board",
			groupRelationKey: "type",
			coverRelationKey: "imageUrl",
		});
	});

	it("falls back to the grid for a layout this build cannot draw", () => {
		// Arrange — a hand-edited row, or a view saved by a newer build
		const view = detail("dv-2", "Impossible", { viewType: "graph" });

		expect(viewLayout(view).layout).toBe("grid");
		expect(viewLayout(undefined).layout).toBe("grid");
	});

	it("prefers the cover the view names over the one it would guess", () => {
		// Arrange — two image-looking columns
		const van = detail("v-1", "Sierra", {
			imageUrl: "https://images.example.com/a.jpg",
			posterUrl: "https://images.example.com/b.jpg",
		});
		const columns: ViewColumn[] = [
			{ key: "name", label: "Name", format: "text" },
			{ key: "imageUrl", label: "Image", format: "shortText" },
			{ key: "posterUrl", label: "Poster", format: "shortText" },
		];

		// Act + Assert
		expect(pickCover(van, columns, "posterUrl")).toBe(
			"https://images.example.com/b.jpg",
		);
		// …and a named cover the row does not carry falls back to the guess
		expect(pickCover(van, columns, "missing")).toBe(
			"https://images.example.com/a.jpg",
		);
	});
});
