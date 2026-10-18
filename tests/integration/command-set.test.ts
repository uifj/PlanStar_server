import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// A set is an object with layout Set (Anytype I.ObjectLayout.Set === 3) whose sources
// (the setOf type ids) drive a record subscription: lib/dataview.ts getRecords passes
// `sources` (not collectionId) to ObjectSearchSubscribe, and the shell expects back every
// object whose type is one of those sources. ObjectToSet converts an object and stores its
// sources; ObjectSetSource rewrites them. Filters on the set query are a later slice, so
// this pins only the type-membership read.
const SET_LAYOUT = 3;

describe.skipIf(!databaseAvailable)("POST /api/command sets", () => {
	const ownerId = "command-set.owner";
	const outsiderId = "command-set.outsider";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: ownerId,
					name: "Set owner",
					email: "command-set-owner@vanlife.test",
				},
				{
					id: outsiderId,
					name: "Set outsider",
					email: "command-set-outsider@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: ownerId } });
		await prisma.user.deleteMany({
			where: { id: { in: [ownerId, outsiderId] } },
		});
	});

	const createSpace = async () => {
		signInAs(ownerId);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Set space" },
				useCase: 2,
			})
		).json();
		return spaceId as string;
	};

	// Obj.typeId is a foreign key to ObjectType, so a set's sources are real type rows.
	// Types are created over the registry REST surface, not a command, so the test seeds
	// them directly (the graph test seeds Link rows the same way).
	let typeSeq = 0;
	const createType = async (spaceId: string, name: string) => {
		typeSeq += 1;
		const type = await prisma.objectType.create({
			data: { spaceId, uniqueKey: `set-type-${typeSeq}`, name },
		});
		return type.id;
	};

	const createObject = async (spaceId: string, name: string) => {
		signInAs(ownerId);
		const { objectId } = await (
			await post("/api/command/ObjectCreate", {
				spaceId,
				details: { name },
			})
		).json();
		return objectId as string;
	};

	const createTypedObject = async (
		spaceId: string,
		name: string,
		typeId: string,
	) => {
		signInAs(ownerId);
		const { objectId } = await (
			await post("/api/command/ObjectCreate", {
				spaceId,
				details: { name, type: [typeId] },
			})
		).json();
		return objectId as string;
	};

	const layoutOf = async (spaceId: string, name: string) => {
		signInAs(ownerId);
		const body = await (
			await post("/api/command/ObjectSearch", {
				spaceId,
				filters: [],
				sorts: [],
				keys: [],
				fullText: name,
				offset: 0,
				limit: 10,
			})
		).json();
		const record = body.records.find((it: any) => it.name === name);
		return record?.layout;
	};

	const subscribeSources = async (
		spaceId: string,
		sources: string[],
		filters: unknown[] = [],
		sorts: unknown[] = [],
	) => {
		signInAs(ownerId);
		return (
			await post("/api/command/ObjectSearchSubscribe", {
				spaceId,
				subId: `set-${sources.join("-")}`,
				filters,
				sorts,
				keys: [],
				source: sources,
				offset: 0,
				limit: 50,
				afterId: "",
				beforeId: "",
				noDeps: false,
				collectionId: "",
			})
		).json();
	};

	it("converts an object to a set and reads its source objects back", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Note type");
		const setObj = await createObject(spaceId, "All notes");
		const first = await createTypedObject(spaceId, "First note", typeId);
		const second = await createTypedObject(spaceId, "Second note", typeId);

		signInAs(ownerId);
		const converted = await (
			await post("/api/command/ObjectToSet", {
				contextId: setObj,
				source: [typeId],
			})
		).json();
		expect(converted.error).toEqual({ code: 0, description: "" });

		expect(await layoutOf(spaceId, "All notes")).toBe(SET_LAYOUT);

		const body = await subscribeSources(spaceId, [typeId]);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id).sort()).toEqual(
			[first, second].sort(),
		);
	});

	it("rewrites the sources so the subscription follows the new type", async () => {
		const spaceId = await createSpace();
		const typeA = await createType(spaceId, "Type A");
		const typeB = await createType(spaceId, "Type B");
		const setObj = await createObject(spaceId, "Switchable set");
		const inA = await createTypedObject(spaceId, "In A", typeA);
		const inB = await createTypedObject(spaceId, "In B", typeB);

		signInAs(ownerId);
		await post("/api/command/ObjectToSet", {
			contextId: setObj,
			source: [typeA],
		});
		expect(
			(await subscribeSources(spaceId, [typeA])).records.map(
				(it: any) => it.id,
			),
		).toEqual([inA]);

		signInAs(ownerId);
		const reset = await (
			await post("/api/command/ObjectSetSource", {
				contextId: setObj,
				source: [typeB],
			})
		).json();
		expect(reset.error).toEqual({ code: 0, description: "" });

		const body = await subscribeSources(spaceId, [typeB]);
		expect(body.records.map((it: any) => it.id)).toEqual([inB]);
	});

	it("omits objects whose type is not one of the sources", async () => {
		const spaceId = await createSpace();
		const wanted = await createType(spaceId, "Wanted type");
		const other = await createType(spaceId, "Other type");
		const match = await createTypedObject(spaceId, "Match", wanted);
		await createTypedObject(spaceId, "No match", other);
		await createObject(spaceId, "Untyped");

		const body = await subscribeSources(spaceId, [wanted]);
		expect(body.records.map((it: any) => it.id)).toEqual([match]);
	});

	it("narrows the records to a wire filter on the set query", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Filtered type");
		const keep = await createTypedObject(spaceId, "Keep me", typeId);
		await createTypedObject(spaceId, "Drop me", typeId);

		// Anytype Mapper.To.Filter wire shape: RelationKey + numeric condition (Like === 7)
		// + the raw value (Encode.value is identity under ts-proto).
		const body = await subscribeSources(
			spaceId,
			[typeId],
			[
				{
					id: "filter-name",
					RelationKey: "name",
					format: 1,
					operator: 2,
					condition: 7,
					value: "keep",
				},
			],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id)).toEqual([keep]);
	});

	it("narrows the records to a checkbox filter on the set query", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Task type");
		const done = await createTypedObject(spaceId, "Done task", typeId);
		await createTypedObject(spaceId, "Open task", typeId);

		// No shim command writes `done` yet, so the fixture sets the column directly (the
		// graph test seeds Link rows the same way). The subscribe must still narrow through
		// the translated wire filter.
		await prisma.obj.update({ where: { id: done }, data: { done: true } });

		const body = await subscribeSources(
			spaceId,
			[typeId],
			[
				{
					id: "filter-done",
					RelationKey: "done",
					format: 4,
					operator: 0,
					condition: 1,
					value: true,
				},
			],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id)).toEqual([done]);
	});

	it("orders the records by a wire sort on the set query", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Sortable type");
		await createTypedObject(spaceId, "Beta note", typeId);
		await createTypedObject(spaceId, "Alpha note", typeId);

		// Anytype Mapper.To.Sort wire shape: RelationKey + numeric SortType (Asc === 0).
		// Newest-first is the default, so name-asc must reorder the records.
		const body = await subscribeSources(
			spaceId,
			[typeId],
			[],
			[{ id: "sort-name", RelationKey: "name", type: 0, format: 1 }],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.name)).toEqual([
			"Alpha note",
			"Beta note",
		]);
	});

	it("orders the records by a custom number relation on the set query", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Priced sortable type");
		const cheap = await createTypedObject(spaceId, "Cheap", typeId);
		const mid = await createTypedObject(spaceId, "Mid", typeId);
		const dear = await createTypedObject(spaceId, "Dear", typeId);

		// A custom relation value rides in the details JSONB, so a sort on `price` cannot be a
		// Prisma orderBy (there is no column). Written in three separate calls cheapest-first,
		// `dear` is the most recently updated, so the default newest-first order is
		// [dear, mid, cheap] — a price-ascending sort must reorder them to [cheap, mid, dear].
		signInAs(ownerId);
		for (const [id, price] of [
			[cheap, 50],
			[mid, 200],
			[dear, 500],
		] as const) {
			await post("/api/command/ObjectListSetDetails", {
				objectIds: [id],
				details: [{ id, details: { price } }],
			});
		}

		// Anytype Mapper.To.Sort wire shape: RelationKey + numeric SortType (Asc === 0) + the
		// relation's numeric format (2 === number).
		const body = await subscribeSources(
			spaceId,
			[typeId],
			[],
			[{ id: "sort-price", RelationKey: "price", type: 0, format: 2 }],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id)).toEqual([cheap, mid, dear]);
	});

	it("orders the records by a custom number relation descending", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Priced desc type");
		const cheap = await createTypedObject(spaceId, "Cheap", typeId);
		const mid = await createTypedObject(spaceId, "Mid", typeId);
		const dear = await createTypedObject(spaceId, "Dear", typeId);

		signInAs(ownerId);
		for (const [id, price] of [
			[cheap, 50],
			[mid, 200],
			[dear, 500],
		] as const) {
			await post("/api/command/ObjectListSetDetails", {
				objectIds: [id],
				details: [{ id, details: { price } }],
			});
		}

		// SortType Desc === 1 reverses the price order.
		const body = await subscribeSources(
			spaceId,
			[typeId],
			[],
			[{ id: "sort-price", RelationKey: "price", type: 1, format: 2 }],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id)).toEqual([dear, mid, cheap]);
	});

	it("sorts records with no custom value last regardless of direction", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Sparse priced type");
		const cheap = await createTypedObject(spaceId, "Cheap", typeId);
		const dear = await createTypedObject(spaceId, "Dear", typeId);
		const blank = await createTypedObject(spaceId, "Blank", typeId);

		// `blank` never gets a price, so its details carry no `price` path at all.
		signInAs(ownerId);
		for (const [id, price] of [
			[cheap, 50],
			[dear, 500],
		] as const) {
			await post("/api/command/ObjectListSetDetails", {
				objectIds: [id],
				details: [{ id, details: { price } }],
			});
		}

		// Descending puts the highest price first, but the empty value still sorts last rather
		// than flipping to the front — empties are last in both directions.
		const body = await subscribeSources(
			spaceId,
			[typeId],
			[],
			[{ id: "sort-price", RelationKey: "price", type: 1, format: 2 }],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id)).toEqual([dear, cheap, blank]);
	});

	it("orders the records by a custom text relation on the set query", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Status text type");
		const banana = await createTypedObject(spaceId, "Banana", typeId);
		const apple = await createTypedObject(spaceId, "Apple", typeId);
		const cherry = await createTypedObject(spaceId, "Cherry", typeId);

		signInAs(ownerId);
		for (const [id, status] of [
			[banana, "banana"],
			[apple, "apple"],
			[cherry, "cherry"],
		] as const) {
			await post("/api/command/ObjectListSetDetails", {
				objectIds: [id],
				details: [{ id, details: { status } }],
			});
		}

		// A custom shortText relation (format 1) sorts lexicographically ascending.
		const body = await subscribeSources(
			spaceId,
			[typeId],
			[],
			[{ id: "sort-status", RelationKey: "status", type: 0, format: 1 }],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id)).toEqual([
			apple,
			banana,
			cherry,
		]);
	});

	it("projects a custom relation value onto the subscribed record", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Priced type");
		const priced = await createTypedObject(spaceId, "Priced note", typeId);

		// The client writes every relation value through ObjectListSetDetails; a dataview
		// reads each cell as a top-level record[relationKey], so the custom value must be
		// projected onto the record, not left buried in the details JSONB.
		signInAs(ownerId);
		await post("/api/command/ObjectListSetDetails", {
			objectIds: [priced],
			details: [{ id: priced, details: { price: 1200 } }],
		});

		const body = await subscribeSources(spaceId, [typeId]);
		expect(body.error).toEqual({ code: 0, description: "" });
		const record = body.records.find((it: any) => it.id === priced);
		expect(record?.price).toBe(1200);
	});

	it("narrows the records by a custom number relation on the set query", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Priced type");
		const cheap = await createTypedObject(spaceId, "Cheap", typeId);
		const pricey = await createTypedObject(spaceId, "Pricey", typeId);

		// Custom relation values ride in the details JSONB; the wire filter carries the
		// numeric relation format (2 === number) so the shim compares on the JSONB path.
		signInAs(ownerId);
		await post("/api/command/ObjectListSetDetails", {
			objectIds: [cheap, pricey],
			details: [
				{ id: cheap, details: { price: 50 } },
				{ id: pricey, details: { price: 500 } },
			],
		});

		const body = await subscribeSources(
			spaceId,
			[typeId],
			[
				{
					id: "filter-price",
					RelationKey: "price",
					format: 2,
					operator: 0,
					condition: 3,
					value: 100,
				},
			],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id)).toEqual([pricey]);
	});

	it("narrows the records by a custom select relation on the set query", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Stocked type");
		const available = await createTypedObject(spaceId, "Available", typeId);
		await createTypedObject(spaceId, "Sold", typeId);

		// Only the first object gets a status; the second has no `status` path at all, so an
		// Equal filter on the JSONB path must exclude it (select === format 3, Equal === 1).
		signInAs(ownerId);
		await post("/api/command/ObjectListSetDetails", {
			objectIds: [available],
			details: [{ id: available, details: { status: "available" } }],
		});

		const body = await subscribeSources(
			spaceId,
			[typeId],
			[
				{
					id: "filter-status",
					RelationKey: "status",
					format: 3,
					operator: 0,
					condition: 1,
					value: "available",
				},
			],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id)).toEqual([available]);
	});

	it("narrows the records to those with no value for a custom relation", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Sparse price type");
		const priced = await createTypedObject(spaceId, "Priced", typeId);
		const blank = await createTypedObject(spaceId, "Blank", typeId);

		// Only `priced` gets a value; `blank` never has the `price` path written, so an Empty
		// filter (condition 11) on the custom relation must keep only `blank`. The value rides in
		// the details JSONB, which Prisma's typed path filter cannot test for absence, so the shim
		// narrows in memory.
		signInAs(ownerId);
		await post("/api/command/ObjectListSetDetails", {
			objectIds: [priced],
			details: [{ id: priced, details: { price: 100 } }],
		});

		const body = await subscribeSources(
			spaceId,
			[typeId],
			[
				{
					id: "filter-price-empty",
					RelationKey: "price",
					format: 2,
					condition: 11,
				},
			],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id)).toEqual([blank]);
	});

	it("narrows the records to those holding a value for a custom relation", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Sparse status type");
		const filled = await createTypedObject(spaceId, "Filled", typeId);
		await createTypedObject(spaceId, "Blank", typeId);

		signInAs(ownerId);
		await post("/api/command/ObjectListSetDetails", {
			objectIds: [filled],
			details: [{ id: filled, details: { status: "ready" } }],
		});

		// NotEmpty (condition 12) is the inverse of Empty: only the record holding a value returns.
		const body = await subscribeSources(
			spaceId,
			[typeId],
			[
				{
					id: "filter-status-notempty",
					RelationKey: "status",
					format: 1,
					condition: 12,
				},
			],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id)).toEqual([filled]);
	});

	it("treats an empty-string custom value as empty", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Blanked text type");
		const cleared = await createTypedObject(spaceId, "Cleared", typeId);
		const filled = await createTypedObject(spaceId, "Filled", typeId);

		// `cleared` has the path written but to an empty string, which counts as no value;
		// `filled` holds a real string, so an Empty filter keeps only `cleared`.
		signInAs(ownerId);
		await post("/api/command/ObjectListSetDetails", {
			objectIds: [cleared, filled],
			details: [
				{ id: cleared, details: { note: "" } },
				{ id: filled, details: { note: "hello" } },
			],
		});

		const body = await subscribeSources(
			spaceId,
			[typeId],
			[
				{
					id: "filter-note-empty",
					RelationKey: "note",
					format: 1,
					condition: 11,
				},
			],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id)).toEqual([cleared]);
	});

	it("treats an empty-array custom value as empty", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Tagged empty type");
		const noTags = await createTypedObject(spaceId, "No tags", typeId);
		const tagged = await createTypedObject(spaceId, "Tagged", typeId);

		// A multiSelect relation persists an array; an empty array is no value, so an Empty
		// filter (condition 11) keeps only `noTags`.
		signInAs(ownerId);
		await post("/api/command/ObjectListSetDetails", {
			objectIds: [noTags, tagged],
			details: [
				{ id: noTags, details: { tags: [] } },
				{ id: tagged, details: { tags: ["x"] } },
			],
		});

		const body = await subscribeSources(
			spaceId,
			[typeId],
			[
				{
					id: "filter-tags-empty",
					RelationKey: "tags",
					format: 11,
					condition: 11,
				},
			],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id)).toEqual([noTags]);
	});

	it("narrows a board column to the records holding its select option", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Board type");
		const inColumn = await createTypedObject(spaceId, "Available van", typeId);
		const otherColumn = await createTypedObject(spaceId, "Sold van", typeId);

		// A board groups on a select relation whose options are real rows the column filter
		// references by id. Seed the relation, then create the options through the command.
		await prisma.relation.create({
			data: { spaceId, uniqueKey: "status", name: "Status", format: "select" },
		});
		signInAs(ownerId);
		const available = await (
			await post("/api/command/ObjectCreateRelationOption", {
				spaceId,
				details: {
					relationKey: "status",
					name: "Available",
					relationOptionColor: "green",
				},
			})
		).json();
		const sold = await (
			await post("/api/command/ObjectCreateRelationOption", {
				spaceId,
				details: {
					relationKey: "status",
					name: "Sold",
					relationOptionColor: "grey",
				},
			})
		).json();

		// The client persists a select value as a one-element array (Relation.formatValue →
		// getArrayValue), so each object's status is written the way the cell writes it.
		await post("/api/command/ObjectListSetDetails", {
			objectIds: [inColumn, otherColumn],
			details: [
				{ id: inColumn, details: { status: [available.objectId] } },
				{ id: otherColumn, details: { status: [sold.objectId] } },
			],
		});

		// The board column subscribes with getGroupFilter → ExactIn(15) carrying the one
		// option id (dataview.ts:538), so only the records in that column come back.
		const body = await subscribeSources(
			spaceId,
			[typeId],
			[
				{
					id: "group-status",
					RelationKey: "status",
					format: 3,
					operator: 0,
					condition: 15,
					value: [available.objectId],
				},
			],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id)).toEqual([inColumn]);
	});

	it("narrows a tag column to every record holding that tag", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Tagged type");
		const both = await createTypedObject(spaceId, "Both tags", typeId);
		const onlyA = await createTypedObject(spaceId, "Only A", typeId);
		const none = await createTypedObject(spaceId, "No tags", typeId);

		// A board can group on a multiSelect (tag) relation. Seed the relation, then create
		// its options through the command.
		await prisma.relation.create({
			data: {
				spaceId,
				uniqueKey: "tags",
				name: "Tags",
				format: "multiSelect",
			},
		});
		signInAs(ownerId);
		const tagA = await (
			await post("/api/command/ObjectCreateRelationOption", {
				spaceId,
				details: {
					relationKey: "tags",
					name: "A",
					relationOptionColor: "green",
				},
			})
		).json();
		const tagB = await (
			await post("/api/command/ObjectCreateRelationOption", {
				spaceId,
				details: {
					relationKey: "tags",
					name: "B",
					relationOptionColor: "blue",
				},
			})
		).json();

		// A multiSelect value persists as an array of every option id the cell holds
		// (Relation.formatValue → getArrayValue), so `both` carries two tags.
		await post("/api/command/ObjectListSetDetails", {
			objectIds: [both, onlyA, none],
			details: [
				{ id: both, details: { tags: [tagA.objectId, tagB.objectId] } },
				{ id: onlyA, details: { tags: [tagA.objectId] } },
				{ id: none, details: { tags: [] } },
			],
		});

		// The tag column subscribes with getGroupFilter → ExactIn(15) carrying the one option
		// id (dataview.ts:538). Unlike a select, a record holding that tag among others must
		// still match, so the filter is a JSONB array-contains, not an exact match.
		const body = await subscribeSources(
			spaceId,
			[typeId],
			[
				{
					id: "group-tags",
					RelationKey: "tags",
					format: 11,
					operator: 0,
					condition: 15,
					value: [tagA.objectId],
				},
			],
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.records.map((it: any) => it.id).sort()).toEqual(
			[both, onlyA].sort(),
		);
	});

	it("answers NOT_FOUND when converting an object that does not exist", async () => {
		await createSpace();
		signInAs(ownerId);
		const res = await (
			await post("/api/command/ObjectToSet", {
				contextId: "missing-object",
				source: [],
			})
		).json();
		expect(res.error).toEqual({ code: 3, description: "Object not found." });
	});

	it("denies a caller who cannot write the space", async () => {
		const spaceId = await createSpace();
		const typeId = await createType(spaceId, "Guarded type");
		const setObj = await createObject(spaceId, "Guarded set");

		signInAs(outsiderId);
		const res = await post("/api/command/ObjectToSet", {
			contextId: setObj,
			source: [typeId],
		});
		expect((await res.json()).error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
	});
});
