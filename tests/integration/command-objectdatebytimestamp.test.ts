import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ObjectDateByTimestamp backs the date mention picker (menu/block/mention.tsx:223), the "add date
// block" menu (menu/block/add.tsx:412) and U.Object.openDateByTimestamp (lib/util/object.ts:779).
// The client sends { spaceId, timestamp } (unix seconds) and reads back { details } for a per-day
// Date-layout object (I.ObjectLayout.Date === 17) whose `timestamp` detail the head renders from
// (page/elements/head/simple.tsx:128). The same day always resolves to the same object, so the id
// is derived from the space + the start of the UTC day.
describe.skipIf(!databaseAvailable)(
	"POST /api/command ObjectDateByTimestamp",
	() => {
		const ownerId = "dateobj.owner";
		const outsiderId = "dateobj.outsider";
		// 2024-07-25T00:00:00Z and a later instant on the same UTC day, plus the next day.
		const day = 1721865600;
		const sameDayLater = day + 18000;
		const nextDay = day + 86400;

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{ id: ownerId, name: "Date owner", email: "dateobj@vanlife.test" },
					{
						id: outsiderId,
						name: "Date outsider",
						email: "dateobj-outsider@vanlife.test",
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
					details: { name: "Date space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		const dateBy = (spaceId: string, timestamp: number) =>
			post("/api/command/ObjectDateByTimestamp", { spaceId, timestamp }).then(
				(r) => r.json(),
			);

		it("finds-or-creates a Date-layout object carrying the day's timestamp", async () => {
			const spaceId = await createSpace();

			signInAs(ownerId);
			const res = await dateBy(spaceId, day);

			expect(res.error).toEqual({ code: 0, description: "" });
			expect(res.details.layout).toBe(17);
			expect(res.details.timestamp).toBe(day);
			expect(res.details.id).toBe(`_date_${spaceId}_${day}`);

			// Real read-back: a date-layout row keyed by the deterministic id.
			const obj = await prisma.obj.findUnique({
				where: { id: `_date_${spaceId}_${day}` },
			});
			expect(obj).not.toBeNull();
			expect(obj?.resolvedLayout).toBe("date");
			expect(obj?.spaceId).toBe(spaceId);
		});

		it("resolves any instant on the same UTC day to the one date object", async () => {
			const spaceId = await createSpace();

			signInAs(ownerId);
			const first = await dateBy(spaceId, day);
			const later = await dateBy(spaceId, sameDayLater);

			expect(later.details.id).toBe(first.details.id);
			expect(later.details.timestamp).toBe(day);

			const count = await prisma.obj.count({
				where: { spaceId, resolvedLayout: "date" },
			});
			expect(count).toBe(1);
		});

		it("mints a distinct object for a different day", async () => {
			const spaceId = await createSpace();

			signInAs(ownerId);
			const first = await dateBy(spaceId, day);
			const next = await dateBy(spaceId, nextDay);

			expect(next.details.id).not.toBe(first.details.id);
			expect(next.details.id).toBe(`_date_${spaceId}_${nextDay}`);
			expect(next.details.timestamp).toBe(nextDay);
		});

		it("refuses a caller who cannot write to the target space", async () => {
			const spaceId = await createSpace();

			signInAs(outsiderId);
			const res = await dateBy(spaceId, day);

			expect(res.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
			expect(res.details).toBeUndefined();
		});
	},
);
