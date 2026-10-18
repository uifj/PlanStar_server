import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// NotificationList { includeRead, limit } (command.ts:1790, booted unread-only in data.ts:496) returns
// the caller's own notifications newest-first. NotificationReply { ids, actionType } (command.ts:1797)
// closes them: Close is the only action, and it marks the caller's rows Replied so they leave the
// unread list. The wire shape is what From.Notification reads (mapper.ts:536): the notification's type
// is derived from WHICH type-named field is present (mapper.ts:94 NotificationPayload) and that field
// carries the payload — so a Join notice projects to { id, createTime, status, isLocal, requestToJoin:
// {...} }. Both commands are scoped to the caller, needing no space-access check (like ChatReadAll).
// Each test signs in as its own recipient so the returned list is exactly what that test seeds.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/NotificationList",
	() => {
		const owner = "notif.owner";
		const rWire = "notif.wire";
		const rUnread = "notif.unread";
		const rLimit = "notif.limit";
		const rEmpty = "notif.empty";
		const rReply = "notif.reply";
		const rScopeA = "notif.scopea";
		const rScopeB = "notif.scopeb";
		const users = [
			owner,
			rWire,
			rUnread,
			rLimit,
			rEmpty,
			rReply,
			rScopeA,
			rScopeB,
		];

		const BASE = 1_700_000_000;
		let spaceId = "";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: users.map((id) => ({
					id,
					name: `Notif ${id}`,
					email: `${id.replace(".", "-")}@vanlife.test`,
				})),
			});
			signInAs(owner);
			const body = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Notif space" },
					useCase: 2,
				})
			).json();
			spaceId = body.spaceId as string;
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({ where: { id: { in: users } } });
		});

		const seed = async (
			userId: string,
			type: string,
			createTime: number,
			payload: Record<string, unknown>,
			status = 0,
		) => {
			const row = await prisma.notification.create({
				data: {
					spaceId,
					userId,
					type,
					status,
					isLocal: false,
					createTime: BigInt(createTime),
					payload: payload as object,
				},
			});
			return row.id;
		};

		const list = async (as: string, includeRead: boolean, limit: number) => {
			signInAs(as);
			return (
				await post("/api/command/NotificationList", { includeRead, limit })
			).json();
		};

		const reply = async (as: string, ids: string[], actionType = 0) => {
			signInAs(as);
			return (
				await post("/api/command/NotificationReply", { ids, actionType })
			).json();
		};

		it("returns the caller's notifications newest-first in the wire shape", async () => {
			const joinPayload = {
				spaceId,
				spaceName: "Notif space",
				identity: `_participant_${spaceId.replace(/\./g, "_")}_${rWire}`,
				identityName: "Alice",
				identityIcon: "",
			};
			const approvePayload = {
				spaceId,
				spaceName: "Notif space",
				permissions: 1,
			};
			const older = await seed(rWire, "requestToJoin", BASE + 5, joinPayload);
			const newer = await seed(
				rWire,
				"participantRequestApproved",
				BASE + 10,
				approvePayload,
			);

			const body = await list(rWire, true, 10);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.notifications).toHaveLength(2);

			const first = body.notifications[0];
			expect(first.id).toBe(newer);
			expect(first.createTime).toBe(BASE + 10);
			expect(typeof first.createTime).toBe("number");
			expect(first.status).toBe(0);
			expect(first.isLocal).toBe(false);
			expect(first.participantRequestApproved).toEqual(approvePayload);
			expect(first.requestToJoin).toBeUndefined();

			const second = body.notifications[1];
			expect(second.id).toBe(older);
			expect(second.requestToJoin).toEqual(joinPayload);
		});

		it("excludes read and replied notifications when includeRead is false", async () => {
			const created = await seed(rUnread, "participantRemove", BASE + 1, {
				spaceId,
				spaceName: "Notif space",
			});
			await seed(
				rUnread,
				"participantRemove",
				BASE + 2,
				{ spaceId, spaceName: "Notif space" },
				2,
			);
			await seed(
				rUnread,
				"participantRemove",
				BASE + 3,
				{ spaceId, spaceName: "Notif space" },
				3,
			);

			const unread = await list(rUnread, false, 10);
			expect(unread.notifications.map((n: any) => n.id)).toEqual([created]);

			const all = await list(rUnread, true, 10);
			expect(all.notifications).toHaveLength(3);
		});

		it("caps the list at limit, newest-first", async () => {
			await seed(rLimit, "participantRemove", BASE + 1, { spaceId });
			const second = await seed(rLimit, "participantRemove", BASE + 2, {
				spaceId,
			});
			const newest = await seed(rLimit, "participantRemove", BASE + 3, {
				spaceId,
			});

			const body = await list(rLimit, true, 2);
			expect(body.notifications.map((n: any) => n.id)).toEqual([
				newest,
				second,
			]);
		});

		it("returns an empty list for a caller with no notifications", async () => {
			const body = await list(rEmpty, true, 10);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.notifications).toEqual([]);
		});

		it("marks the caller's notifications replied so they leave the unread list", async () => {
			const id = await seed(rReply, "participantRequestDecline", BASE + 1, {
				spaceId,
				spaceName: "Notif space",
			});

			const replied = await reply(rReply, [id]);
			expect(replied.error).toEqual({ code: 0, description: "" });

			const unread = await list(rReply, false, 10);
			expect(unread.notifications).toEqual([]);

			const all = await list(rReply, true, 10);
			expect(all.notifications).toHaveLength(1);
			expect(all.notifications[0].status).toBe(3);
		});

		it("scopes NotificationReply to the caller", async () => {
			const id = await seed(rScopeA, "participantRemove", BASE + 1, {
				spaceId,
			});

			const body = await reply(rScopeB, [id]);
			expect(body.error).toEqual({ code: 0, description: "" });

			// The other caller's reply is a no-op: A's notice is still unread, B has none.
			const aUnread = await list(rScopeA, false, 10);
			expect(aUnread.notifications.map((n: any) => n.id)).toEqual([id]);
			const bUnread = await list(rScopeB, false, 10);
			expect(bUnread.notifications).toEqual([]);
		});
	},
);
