import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ObjectLayout (front_web interface/object.ts): Page 0, Set 3, Bookmark 11, Collection 14, Date 17.
// The client picks the screen from the record it re-reads after a navigation, so an object whose
// stored layout is a set must come back as one — the set screen (page/main/set.tsx) never mounts
// for a record that reads as a page, which is why a converted set showed only its title.
const LAYOUT_PAGE = 0;
const LAYOUT_SET = 3;
const LAYOUT_BOOKMARK = 11;

describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectOpen keeps each object's real layout",
	() => {
		const userId = "command-setlayout.owner";

		let spaceId = "";
		let sourceId = "";

		const openDetails = async (objectId: string) => {
			const body = await (
				await post("/api/command/ObjectOpen", { spaceId, objectId })
			).json();
			expect(body.error).toEqual({ code: 0, description: "" });
			const entry = (body.objectView.details || []).find(
				(it: any) => it.id === objectId,
			);
			return entry ? entry.details : {};
		};

		beforeAll(async () => {
			const stale = await prisma.space.findMany({
				where: { createdBy: userId },
				select: { id: true },
			});
			const staleIds = stale.map((it) => it.id);
			await prisma.obj.deleteMany({ where: { spaceId: { in: staleIds } } });
			await prisma.objectType.deleteMany({
				where: { spaceId: { in: staleIds } },
			});
			await prisma.spaceMember.deleteMany({ where: { userId } });
			await prisma.space.deleteMany({ where: { createdBy: userId } });
			await prisma.user.deleteMany({ where: { id: userId } });
			await prisma.user.create({
				data: {
					id: userId,
					name: "Set layout owner",
					email: "command-setlayout-owner@vanlife.test",
				},
			});

			signInAs(userId);
			spaceId = (
				await (
					await post("/api/command/WorkspaceCreate", {
						details: { name: "Layout space" },
						useCase: 2,
					})
				).json()
			).spaceId as string;

			sourceId = (
				await (
					await post("/api/command/ObjectCreate", {
						spaceId,
						objectTypeUniqueKey: "ot-page",
						details: { name: "A source page" },
					})
				).json()
			).objectId as string;
		});

		it("opens a plain page as a page", async () => {
			signInAs(userId);
			const details = await openDetails(sourceId);
			expect(details.layout).toBe(LAYOUT_PAGE);
		});

		it("opens a set created by ObjectCreateSet as a set", async () => {
			signInAs(userId);
			const created = await (
				await post("/api/command/ObjectCreateSet", {
					spaceId,
					details: { name: "Created set" },
				})
			).json();
			expect(created.error).toEqual({ code: 0, description: "" });

			const details = await openDetails(created.objectId);
			expect(details.layout).toBe(LAYOUT_SET);
			expect(details.resolvedLayout).toBe(LAYOUT_SET);
		});

		it("opens an object converted by ObjectToSet as a set, with its sources", async () => {
			signInAs(userId);
			const page = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					objectTypeUniqueKey: "ot-page",
					details: { name: "Converted set" },
				})
			).json();

			const converted = await (
				await post("/api/command/ObjectToSet", {
					contextId: page.objectId,
					source: [sourceId],
				})
			).json();
			expect(converted.error).toEqual({ code: 0, description: "" });

			const details = await openDetails(page.objectId);
			expect(details.layout).toBe(LAYOUT_SET);
			expect(details.setOf).toEqual([sourceId]);
		});

		it("opens a bookmark as a bookmark", async () => {
			signInAs(userId);
			const created = await (
				await post("/api/command/ObjectCreateFromUrl", {
					spaceId,
					url: "https://example.com/",
				})
			).json();
			expect(created.error).toEqual({ code: 0, description: "" });

			const details = await openDetails(created.objectId);
			expect(details.layout).toBe(LAYOUT_BOOKMARK);
		});
	},
);
