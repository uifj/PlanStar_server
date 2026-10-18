import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ChatUnsubscribe { chatObjectId, subId } (command.ts:2056) tears down a chat subscription. The web
// backend keeps no server-side subscription handles — chat subscriptions live in the client's S.Chat
// store and every chat read is a plain request/response — so there is nothing to release. It answers OK
// unconditionally, mirroring the accepted ObjectSearchUnsubscribe no-op (service.ts:520). The test pins
// that the command is reachable and succeeds rather than falling through to NOT_SUPPORTED (code 12).
describe.skipIf(!databaseAvailable)("POST /api/command/ChatUnsubscribe", () => {
	const owner = "chat-unsub.owner";

	beforeAll(async () => {
		await prisma.user.create({
			data: {
				id: owner,
				name: "Unsub owner",
				email: "chat-unsub-owner@vanlife.test",
			},
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: owner } });
		await prisma.user.deleteMany({ where: { id: owner } });
	});

	it("acknowledges a chat subscription teardown", async () => {
		signInAs(owner);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Unsub space" },
				useCase: 2,
			})
		).json();
		const { objectId } = await (
			await post("/api/command/ObjectCreate", {
				spaceId,
				details: { name: "Chat" },
			})
		).json();

		const body = await (
			await post("/api/command/ChatUnsubscribe", {
				chatObjectId: objectId,
				subId: `chat-${objectId}`,
			})
		).json();

		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.event).toBeNull();
	});

	it("is lenient for an unknown chat or stale subId", async () => {
		signInAs(owner);
		const body = await (
			await post("/api/command/ChatUnsubscribe", {
				chatObjectId: "does-not-exist",
				subId: "stale-sub",
			})
		).json();

		expect(body.error).toEqual({ code: 0, description: "" });
	});
});
