import { genkit } from "genkit/beta";
import { mockModel } from "genkit/testing";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { createTripPlannerAgent } from "../../src/modules/agent/agent.js";
import { createAgentService } from "../../src/modules/agent/service.js";
import { PrismaAgentChatStore } from "../../src/modules/agent/session-store.js";
import { VAN_LIFE_SPACE_ID } from "../../src/modules/vanlife/constants.js";
import { asAuthUser } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";

const databaseAvailable = await isDatabaseAvailable();

async function createUser(email: string) {
	return prisma.user.create({
		data: {
			id: `user-${email}`,
			name: email.split("@")[0],
			email,
			role: "user",
		},
	});
}

function plannerService(ai: ReturnType<typeof genkit>, reply: string) {
	return createAgentService({
		agent: createTripPlannerAgent(ai, {
			model: mockModel(ai, {
				name: `model-${reply.length}`,
				respond: [{ text: reply }],
			}),
			store: new PrismaAgentChatStore(),
		}),
	});
}

describe.skipIf(!databaseAvailable)("trip planner conversations", () => {
	afterAll(async () => {
		// These ids are this file's own namespace; leaving them behind makes the
		// next run collide on the primary key.
		await prisma.user.deleteMany({ where: { id: { startsWith: "user-" } } });
	});

	it("records which space a conversation plans in", async () => {
		// Arrange
		const owner = await createUser("space.owner@vanlife.test");
		const ai = genkit({});

		// Act
		const first = await plannerService(ai, "Noted.").respond({
			actor: asAuthUser(owner),
			message: "Find me a van for autumn",
		});

		// Assert — the chat knows its space, so its tools never have to guess
		expect(
			await prisma.agentChat.findUnique({
				where: { id: first.chatId },
				select: { userId: true, spaceId: true },
			}),
		).toEqual({ userId: owner.id, spaceId: VAN_LIFE_SPACE_ID });
	});

	it("restores an earlier turn from the database in a later request", async () => {
		// Arrange
		const owner = await createUser("store.owner@vanlife.test");
		const ai = genkit({});
		const model = mockModel(ai, {
			name: "restoreModel",
			respond: [{ text: "First answer." }, { text: "Second answer." }],
		});
		const service = createAgentService({
			agent: createTripPlannerAgent(ai, {
				model,
				store: new PrismaAgentChatStore(),
			}),
		});
		const actor = asAuthUser(owner);

		// Act — two separate requests, as a client would make them
		const first = await service.respond({
			actor,
			message: "I want a rugged van in Moab",
		});
		const second = await service.respond({
			actor,
			chatId: first.chatId,
			message: "make it under $150",
		});

		// Assert
		expect(first.reply).toBe("First answer.");
		expect(second.reply).toBe("Second answer.");
		expect(second.chatId).toBe(first.chatId);
		expect(model.requests).toHaveLength(2);
		expect(JSON.stringify(model.requests[1]?.messages)).toContain(
			"I want a rugged van in Moab",
		);
		expect(await prisma.agentChat.count({ where: { id: first.chatId } })).toBe(
			1,
		);
	});

	it("refuses to resume a conversation owned by someone else", async () => {
		// Arrange
		const owner = await createUser("chat.owner@vanlife.test");
		const intruder = await createUser("chat.intruder@vanlife.test");
		const ai = genkit({});
		const service = plannerService(ai, "hi");
		const chat = await service.respond({
			actor: asAuthUser(owner),
			message: "planning",
		});

		// Act
		const attempt = service.respond({
			actor: asAuthUser(intruder),
			chatId: chat.chatId,
			message: "give me their history",
		});

		// Assert
		await expect(attempt).rejects.toMatchObject({ statusCode: 403 });
	});
});
