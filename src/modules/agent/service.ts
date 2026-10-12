import { randomUUID } from "node:crypto";
import type { Agent } from "genkit/beta";
import { AgentError } from "genkit/beta";
import {
	ForbiddenError,
	NotFoundError,
	ServiceUnavailableError,
} from "../../errors/http-errors.js";
import { prisma } from "../../lib/prisma.js";
import { TRIP_PLANNER_AGENT_NAME } from "./constants.js";

export type AgentReply = {
	chatId: string;
	snapshotId?: string;
	reply: string;
};

export type AgentRequest = {
	userId: string;
	chatId?: string;
	message: string;
};

export function createAgentService({ agent }: { agent: Agent<unknown> }): {
	respond: (request: AgentRequest) => Promise<AgentReply>;
} {
	async function respond({ userId, chatId, message }: AgentRequest) {
		const id = chatId ?? randomUUID();

		if (chatId) {
			const chat = await prisma.agentChat.findUnique({
				where: { id },
			});

			if (!chat) {
				throw new NotFoundError("Conversation not found.");
			}

			if (chat.userId !== userId) {
				throw new ForbiddenError("You cannot continue this conversation.");
			}
		} else {
			await prisma.agentChat.create({
				data: {
					id,
					userId,
					agentName: TRIP_PLANNER_AGENT_NAME,
				},
			});
		}

		const chat = agent.chat({ sessionId: id });

		try {
			const response = await chat.send(message);

			return {
				chatId: id,
				snapshotId: chat.snapshotId,
				reply: response.text ?? "",
			};
		} catch (err) {
			if (err instanceof AgentError && err.status === "FAILED_PRECONDITION") {
				throw new ServiceUnavailableError(
					"The trip planner is temporarily unavailable.",
				);
			}

			throw err;
		}
	}

	return { respond };
}
