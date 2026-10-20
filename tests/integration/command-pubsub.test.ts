import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import {
	type PubsubMessage,
	pubsubRelay,
} from "../../src/modules/pubsub/relay.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// Pubsub is the web shell's presence + chat typing status. The command switch registers
// topic subscriptions against the caller's account and relays a published payload to the
// OTHER members' live connections; the shell reads those back as Event_PubsubMessage on
// its /events stream (tested live in the browser). Through HTTP we verify the two real
// behaviours: a member can subscribe and receive another member's publish (self-echo
// excluded), and a non-member is FORBIDDEN from listening into a space.
describe.skipIf(!databaseAvailable)("POST /api/command/Pubsub*", () => {
	const ownerId = "pubsub.owner";
	const readerId = "pubsub.reader";
	const outsiderId = "pubsub.outsider";

	beforeAll(async () => {
		// Clean any rows left by a prior aborted run so this suite is idempotent.
		await prisma.space.deleteMany({
			where: { createdBy: { in: [ownerId, readerId, outsiderId] } },
		});
		await prisma.user.deleteMany({
			where: { id: { in: [ownerId, readerId, outsiderId] } },
		});
		await prisma.user.createMany({
			data: [
				{ id: ownerId, name: "Pub owner", email: "pub-owner@vanlife.test" },
				{ id: readerId, name: "Pub reader", email: "pub-reader@vanlife.test" },
				{
					id: outsiderId,
					name: "Pub outsider",
					email: "pub-outsider@vanlife.test",
				},
			],
		});
	});

	let spaceId = "";
	const closes: Array<() => void> = [];

	afterEach(async () => {
		for (const close of closes.splice(0)) {
			close();
		}
	});

	const createSpace = async () => {
		signInAs(ownerId);
		const { spaceId: id } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Presence space" },
				useCase: 2,
			})
		).json();
		// Enrol the reader as an active member so it can subscribe to the space.
		await prisma.spaceMember.create({
			data: { spaceId: id as string, userId: readerId, permission: "reader" },
		});
		spaceId = id as string;
		return id as string;
	};

	const publishCommand = async (
		publisher: string,
		space: string,
		topic: string,
		text: string,
	) => {
		signInAs(publisher);
		return await (
			await post("/api/command/PubsubPublish", {
				spaceId: space,
				topic,
				payload: Buffer.from(text, "utf-8").toString("base64"),
			})
		).json();
	};

	it("delivers another member's publish to a subscribed member's connection", async () => {
		const space = await createSpace();
		const received: PubsubMessage[] = [];

		closes.push(
			pubsubRelay.connect(readerId, (message) => received.push(message)),
		);

		signInAs(readerId);
		const subscribed = await (
			await post("/api/command/PubsubSubscribe", {
				spaceId: space,
				topics: ["presence/object-1"],
				subId: "sub-reader-1",
			})
		).json();
		expect(subscribed.error).toEqual({ code: 0, description: "" });

		const published = await publishCommand(
			ownerId,
			space,
			"presence/object-1",
			"hello",
		);
		expect(published.error).toEqual({ code: 0, description: "" });

		expect(received.length).toBe(1);
		expect(received[0].topic).toBe("presence/object-1");
		expect(received[0].spaceId).toBe(space);
		expect(received[0].identity).toBe(ownerId);
		expect(received[0].subIds).toEqual(["sub-reader-1"]);
		expect(new TextDecoder().decode(received[0].payload)).toBe("hello");
	});

	it("never echoes the publisher back to its own connection", async () => {
		const space = await createSpace();
		const received: PubsubMessage[] = [];

		closes.push(
			pubsubRelay.connect(ownerId, (message) => received.push(message)),
		);

		signInAs(ownerId);
		await post("/api/command/PubsubSubscribe", {
			spaceId: space,
			topics: ["status/chat-1"],
			subId: "sub-owner-1",
		});

		await publishCommand(ownerId, space, "status/chat-1", "typing");

		expect(received.length).toBe(0);
	});

	it("stops delivering after the member unsubscribes", async () => {
		const space = await createSpace();
		const received: PubsubMessage[] = [];

		closes.push(
			pubsubRelay.connect(readerId, (message) => received.push(message)),
		);

		signInAs(readerId);
		await post("/api/command/PubsubSubscribe", {
			spaceId: space,
			topics: ["presence/object-1"],
			subId: "sub-reader-2",
		});

		signInAs(readerId);
		const unsub = await (
			await post("/api/command/PubsubUnsubscribe", { subId: "sub-reader-2" })
		).json();
		expect(unsub.error).toEqual({ code: 0, description: "" });

		await publishCommand(ownerId, space, "presence/object-1", "late");

		expect(received.length).toBe(0);
	});

	it("forbids a non-member from subscribing into the space", async () => {
		const space = await createSpace();

		signInAs(outsiderId);
		const body = await (
			await post("/api/command/PubsubSubscribe", {
				spaceId: space,
				topics: ["presence/object-1"],
				subId: "sub-outsider",
			})
		).json();

		expect(body.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
	});
});
