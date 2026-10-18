import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The sidebar's object-list widgets (All objects / Favorites / Bin) and the per-widget
// tree/list subscriptions send an ObjectSearchSubscribe carrying filters + keys + sorts but
// NO collectionId and NO set `source` (widget/index.tsx getData -> U.Subscription.subscribe).
// U.Subscription.getBaseFilters always injects isDeleted/isArchived/isHidden NotEqual true
// before the wire call, so the shim must run a real Obj query scoped to the space, narrow it
// through the translated filters, and project the live rows via objectRecord. A subId that is
// one of the special-purpose registries (chat, discussion, store, tree edges, library,
// template, file manager) is NOT an object list and must stay empty.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectSearchSubscribe (general object list)",
	() => {
		const owner = "obj-sub.owner";
		const outsider = "obj-sub.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Object sub owner",
						email: "obj-sub-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Object sub outsider",
						email: "obj-sub-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({
				where: { id: { in: [owner, outsider] } },
			});
		});

		const createSpace = async (name = "Object sub space") => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		const createObject = async (spaceId: string, name: string) => {
			signInAs(owner);
			const { objectId } = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name },
				})
			).json();
			return objectId as string;
		};

		const createType = async (spaceId: string, name: string) => {
			signInAs(owner);
			const created = await (
				await post("/api/command/ObjectCreateObjectType", {
					spaceId,
					details: { name },
					internalFlags: [],
				})
			).json();
			return created.details.uniqueKey as string;
		};

		const setObjectType = async (objectId: string, uniqueKey: string) => {
			signInAs(owner);
			await post("/api/command/ObjectSetObjectType", {
				contextId: objectId,
				objectTypeUniqueKey: uniqueKey,
			});
		};

		// The base filters U.Subscription.getBaseFilters injects on every object-list
		// subscribe (ignoreDeleted/ignoreArchived/ignoreHidden all default true).
		const baseFilters = () => [
			{ RelationKey: "isDeleted", format: 6, condition: 2, value: true },
			{ RelationKey: "isArchived", format: 6, condition: 2, value: true },
			{ RelationKey: "isHidden", format: 6, condition: 2, value: true },
		];

		const subscribe = async (
			spaceId: string,
			subId: string,
			filters: unknown[] = baseFilters(),
			sorts: unknown[] = [],
			as: string = owner,
		) => {
			signInAs(as);
			return (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId,
					filters,
					sorts,
					keys: ["id", "name", "layout", "isFavorite", "isArchived"],
					source: [],
					limit: 0,
					offset: 0,
					noDepSubscription: true,
					collectionId: "",
				})
			).json();
		};

		it("returns the space's live objects for a general object-list subscription", async () => {
			const spaceId = await createSpace();
			const first = await createObject(spaceId, "First");
			const second = await createObject(spaceId, "Second");
			const third = await createObject(spaceId, "Third");

			const body = await subscribe(spaceId, `widget-${spaceId}-objects`);

			expect(body.error).toEqual({ code: 0, description: "" });
			const ids = body.records.map((it: any) => it.id);
			expect(ids).toContain(first);
			expect(ids).toContain(second);
			expect(ids).toContain(third);
			const names = body.records.map((it: any) => it.name);
			expect(names).toContain("First");
			expect(names).toContain("Second");
			expect(names).toContain("Third");
		});

		// U.Subscription.subscribeIds-style widgets and the settings library rail's search both
		// narrow by id, so an `id In [...]` filter has to constrain the answer rather than be
		// dropped and hand back every live object in the space.
		it("narrows to the ids an id filter names", async () => {
			const spaceId = await createSpace();
			const wanted = await createObject(spaceId, "Wanted");
			await createObject(spaceId, "Unwanted");

			const body = await subscribe(spaceId, `widget-${spaceId}-ids`, [
				...baseFilters(),
				{ RelationKey: "id", format: 0, condition: 9, value: [wanted] },
			]);

			expect(body.records.map((it: any) => it.id)).toEqual([wanted]);
		});

		it("forbids a non-member from reading the space's object list", async () => {
			const spaceId = await createSpace();
			await createObject(spaceId, "Guarded");

			const body = await subscribe(
				spaceId,
				`widget-${spaceId}-objects`,
				baseFilters(),
				[],
				outsider,
			);

			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});

		it("keeps a special-purpose subId empty rather than leaking object rows", async () => {
			const spaceId = await createSpace();
			await createObject(spaceId, "Not a message");

			// A chat feed subscription names the same space but is not an object list; it must
			// stay empty (EMPTY_SUB_IDS) instead of being answered with the space's Obj rows.
			const body = await subscribe(spaceId, `chat-${spaceId}`);

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.records).toEqual([]);
		});

		it("narrows to favorites and projects isFavorite on the record", async () => {
			const spaceId = await createSpace();
			const starred = await createObject(spaceId, "Starred");
			const plain = await createObject(spaceId, "Plain");
			await prisma.obj.update({
				where: { id: starred },
				data: { isFavorite: true },
			});

			// The Favorites widget adds `isFavorite Equal true` on top of the base filters.
			const body = await subscribe(spaceId, `widget-${spaceId}-objects`, [
				...baseFilters(),
				{ RelationKey: "isFavorite", format: 6, condition: 1, value: true },
			]);

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.records.map((it: any) => it.id)).toEqual([starred]);
			expect(body.records[0].isFavorite).toBe(true);
			expect(body.records.map((it: any) => it.id)).not.toContain(plain);
		});

		it("excludes archived objects by default and lists only them for the bin", async () => {
			const spaceId = await createSpace();
			const live = await createObject(spaceId, "Live");
			const binned = await createObject(spaceId, "Binned");
			await prisma.obj.update({
				where: { id: binned },
				data: { isArchived: true },
			});

			// Default object list: getBaseFilters injects `isArchived NotEqual true`.
			const liveBody = await subscribe(spaceId, `widget-${spaceId}-objects`);
			const liveIds = liveBody.records.map((it: any) => it.id);
			expect(liveIds).toContain(live);
			expect(liveIds).not.toContain(binned);

			// Bin widget: ignoreArchived is false, so no NotEqual guard, and it pushes
			// `isArchived Equal true` — only the archived object comes back.
			const binBody = await subscribe(spaceId, `widget-${spaceId}-objects`, [
				{ RelationKey: "isDeleted", format: 6, condition: 2, value: true },
				{ RelationKey: "isHidden", format: 6, condition: 2, value: true },
				{ RelationKey: "isArchived", format: 6, condition: 1, value: true },
			]);
			expect(binBody.records.map((it: any) => it.id)).toEqual([binned]);
		});

		it("narrows to objects of a type matched by type.uniqueKey Equal", async () => {
			const spaceId = await createSpace();
			const noteKey = await createType(spaceId, "Note");
			const note = await createObject(spaceId, "A note");
			await createObject(spaceId, "A page");
			await setObjectType(note, noteKey);

			// `type.uniqueKey` is a nested relation: the shim must resolve the key to the
			// space's ObjectType id and constrain Obj.typeId, not drop the filter.
			const body = await subscribe(spaceId, `widget-${spaceId}-objects`, [
				...baseFilters(),
				{
					RelationKey: "type.uniqueKey",
					format: 100,
					condition: 1,
					value: noteKey,
				},
			]);

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.records.map((it: any) => it.id)).toEqual([note]);
		});

		it("excludes a type matched by type.uniqueKey NotEqual, keeping untyped objects", async () => {
			const spaceId = await createSpace();
			const noteKey = await createType(spaceId, "Note");
			const note = await createObject(spaceId, "A note");
			const plain = await createObject(spaceId, "A page");
			await setObjectType(note, noteKey);

			const body = await subscribe(spaceId, `widget-${spaceId}-objects`, [
				...baseFilters(),
				{
					RelationKey: "type.uniqueKey",
					format: 100,
					condition: 2,
					value: noteKey,
				},
			]);

			const ids = body.records.map((it: any) => it.id);
			expect(ids).toContain(plain);
			expect(ids).not.toContain(note);
		});
	},
);
