import { randomUUID } from "node:crypto";
import type { Agent } from "genkit/beta";
import { AgentError } from "genkit/beta";
import {
	ForbiddenError,
	NotFoundError,
	ServiceUnavailableError,
} from "../../errors/http-errors.js";
import type { AuthUser } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { vanLifeService } from "../vanlife/service.js";
import { TRIP_PLANNER_AGENT_NAME } from "./constants.js";

export type AgentReply = {
	chatId: string;
	snapshotId?: string;
	reply: string;
};

export type AgentRequest = {
	actor: AuthUser;
	chatId?: string;
	message: string;
};

export function createAgentService({ agent }: { agent: Agent<unknown> }): {
	respond: (request: AgentRequest) => Promise<AgentReply>;
} {
	async function respond({ actor, chatId, message }: AgentRequest) {
		const id = chatId ?? randomUUID();
		let startedInSpace: string | null = null;

		if (chatId) {
			const existing = await prisma.agentChat.findUnique({
				where: { id },
			});

			if (!existing) {
				throw new NotFoundError("Conversation not found.");
			}

			if (existing.userId !== actor.id) {
				throw new ForbiddenError("You cannot continue this conversation.");
			}

			startedInSpace = existing.spaceId;
		}

		// A conversation keeps the space it started in. Rows from before ADR-0011,
		// and every new conversation, take the caller's space - resolving it also
		// enrols the caller, so the tools may read the kernel on their behalf.
		const spaceId =
			startedInSpace ?? (await vanLifeService.ensureVanLifeSpace(actor));

		if (!chatId) {
			await prisma.agentChat.create({
				data: {
					id,
					userId: actor.id,
					agentName: TRIP_PLANNER_AGENT_NAME,
					spaceId,
				},
			});
		}

		// Genkit refuses client-supplied state on an agent with a store, so the
		// conversation row - not the request - is what a tool reads the actor from.
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
