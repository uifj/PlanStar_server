import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The Anytype client writes every relation value through ObjectListSetDetails
// (command.ts:1394): rename, custom relations and checkboxes all funnel here. Each entry is
// Mapper.To.Details output — { id, details: { [relationKey]: value } } (mapper.ts:198). The
// shim must persist system keys onto their Obj columns and merge the rest into the details
// JSONB, so a dataview can read custom values back off the subscription record.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectListSetDetails",
	() => {
		const ownerId = "command-setdetails.owner";
		const outsiderId = "command-setdetails.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Details owner",
						email: "command-setdetails-owner@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Details outsider",
						email: "command-setdetails-outsider@vanlife.test",
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
					details: { name: "Details space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
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

		const setDetails = async (entries: { id: string; details: unknown }[]) => {
			signInAs(ownerId);
			return (
				await post("/api/command/ObjectListSetDetails", {
					objectIds: entries.map((entry) => entry.id),
					details: entries,
				})
			).json();
		};

		it("renames an object by writing the name column", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Before");

			const res = await setDetails([
				{ id: objectId, details: { name: "After" } },
			]);
			expect(res.error).toEqual({ code: 0, description: "" });

			const obj = await prisma.obj.findUnique({ where: { id: objectId } });
			expect(obj?.name).toBe("After");

			// The rename is visible through the object's own details projection.
			signInAs(ownerId);
			const opened = await (
				await post("/api/command/ObjectOpen", { objectId })
			).json();
			const rootDetails = opened.objectView.details.find(
				(d: any) => d.id === objectId,
			);
			expect(rootDetails.details.name).toBe("After");
		});

		it("persists a custom relation value into the details JSONB", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Priced");

			const res = await setDetails([
				{ id: objectId, details: { price: 1200, status: "available" } },
			]);
			expect(res.error).toEqual({ code: 0, description: "" });

			const obj = await prisma.obj.findUnique({ where: { id: objectId } });
			const details = obj?.details as Record<string, unknown>;
			expect(details.price).toBe(1200);
			expect(details.status).toBe("available");
			// The layout marker written at create time survives the merge.
			expect(details.layout).toBe("page");
		});

		it("exposes a custom relation value through the opened object's details", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Priced page");

			await setDetails([{ id: objectId, details: { price: 1200 } }]);

			// The page's relation editor reads cells off objectView.details, so the custom
			// value must be projected there too, not only onto the dataview record.
			signInAs(ownerId);
			const opened = await (
				await post("/api/command/ObjectOpen", { objectId })
			).json();
			const rootDetails = opened.objectView.details.find(
				(d: any) => d.id === objectId,
			);
			expect(rootDetails.details.price).toBe(1200);
			expect(rootDetails.details.name).toBe("Priced page");
		});

		it("maps a checkbox relation onto its column", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Task");

			const res = await setDetails([{ id: objectId, details: { done: true } }]);
			expect(res.error).toEqual({ code: 0, description: "" });

			const obj = await prisma.obj.findUnique({ where: { id: objectId } });
			expect(obj?.done).toBe(true);
		});

		it("answers NOT_FOUND when an entry targets a missing object", async () => {
			await createSpace();
			const res = await setDetails([
				{ id: "missing-object", details: { name: "Nope" } },
			]);
			expect(res.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("denies a caller who cannot write the space", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Guarded");

			signInAs(outsiderId);
			const res = await post("/api/command/ObjectListSetDetails", {
				objectIds: [objectId],
				details: [{ id: objectId, details: { name: "Hijacked" } }],
			});
			expect((await res.json()).error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});

		it("persists custom details supplied at create time", async () => {
			const spaceId = await createSpace();
			signInAs(ownerId);
			const { objectId } = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name: "Born priced", price: 999 },
				})
			).json();

			const obj = await prisma.obj.findUnique({ where: { id: objectId } });
			const details = obj?.details as Record<string, unknown>;
			expect(details.price).toBe(999);
			expect(obj?.name).toBe("Born priced");
		});
	},
);
