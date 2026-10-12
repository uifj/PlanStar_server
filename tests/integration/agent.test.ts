import { genkit } from "genkit/beta";
import { mockModel } from "genkit/testing";
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { createTripPlannerAgent } from "../../src/modules/agent/agent.js";
import { createAgentService } from "../../src/modules/agent/service.js";
import { PrismaAgentChatStore } from "../../src/modules/agent/session-store.js";
import { isDatabaseAvailable } from "./helpers/database.js";

const databaseAvailable = await isDatabaseAvailable();

async function createUser(email: string) {
	return prisma.user.create({
		data: {
			id: `user-${email}`,
			name: email.split("@")[0],
			email,
		},
	});
}

describe.skipIf(!databaseAvailable)("trip planner conversations", () => {
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

		// Act — two separate requests, as a client would make them
		const first = await service.respond({
			userId: owner.id,
			message: "I want a rugged van in Moab",
		});
		const second = await service.respond({
			userId: owner.id,
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
		const service = createAgentService({
			agent: createTripPlannerAgent(ai, {
				model: mockModel(ai, {
					name: "intruderModel",
					respond: [{ text: "hi" }],
				}),
				store: new PrismaAgentChatStore(),
			}),
		});
		const chat = await service.respond({
			userId: owner.id,
			message: "planning",
		});

		// Act
		const attempt = service.respond({
			userId: intruder.id,
			chatId: chat.chatId,
			message: "give me their history",
		});

		// Assert
		await expect(attempt).rejects.toMatchObject({ statusCode: 403 });
	});
});
