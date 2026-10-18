import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// Anytype's I.ObjectLayout.Collection === 14. U.Object.isCollectionLayout keys off that
// number, so an object only behaves as a collection in the shell once its record
// carries layout 14. ObjectToCollection converts a plain object; the projection reads
// the persisted resolvedLayout through NUMERIC_LAYOUT.
const COLLECTION_LAYOUT = 14;

describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectToCollection",
	() => {
		const ownerId = "command-tocollection.owner";
		const outsiderId = "command-tocollection.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "ToCollection owner",
						email: "command-tocollection-owner@vanlife.test",
					},
					{
						id: outsiderId,
						name: "ToCollection outsider",
						email: "command-tocollection-outsider@vanlife.test",
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
					details: { name: "ToCollection space" },
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

		it("converts an object so its record carries the collection layout", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Reading list");

			expect(await layoutOf(spaceId, "Reading list")).not.toBe(
				COLLECTION_LAYOUT,
			);

			signInAs(ownerId);
			const res = await (
				await post("/api/command/ObjectToCollection", { contextId: objectId })
			).json();
			expect(res.error).toEqual({ code: 0, description: "" });

			expect(await layoutOf(spaceId, "Reading list")).toBe(COLLECTION_LAYOUT);
		});

		it("answers NOT_FOUND for an object that does not exist", async () => {
			await createSpace();
			signInAs(ownerId);
			const res = await (
				await post("/api/command/ObjectToCollection", {
					contextId: "missing-object",
				})
			).json();
			expect(res.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("denies a caller who cannot write the space", async () => {
			const spaceId = await createSpace();
			const objectId = await createObject(spaceId, "Guarded list");

			signInAs(outsiderId);
			const res = await post("/api/command/ObjectToCollection", {
				contextId: objectId,
			});
			expect((await res.json()).error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
