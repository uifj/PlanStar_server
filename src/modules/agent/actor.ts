import type { AuthUser } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { VAN_LIFE_SPACE_ID } from "../vanlife/constants.js";

export interface AgentSession {
	actor: AuthUser;
	spaceId: string;
}

// ADR-0011: a tool asks who is speaking through this service instead of reading a
// table, because Genkit will not let an agent with a store take state from the
// caller. A conversation from before the column existed plans in the shared space.
async function findSession(
	sessionId: string,
): Promise<AgentSession | undefined> {
	const chat = await prisma.agentChat.findUnique({
		where: { id: sessionId },
		select: { spaceId: true, user: true },
	});

	if (!chat) {
		return undefined;
	}

	return {
		actor: chat.user,
		spaceId: chat.spaceId ?? VAN_LIFE_SPACE_ID,
	};
}

export const agentSessionService = {
	findSession,
};
