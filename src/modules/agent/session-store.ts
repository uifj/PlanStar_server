import { randomUUID } from "node:crypto";
import type {
	SessionSnapshot,
	SessionStore,
	SessionStoreOptions,
	SnapshotMutator,
} from "genkit/beta";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

type GetSnapshotOptions = Parameters<SessionStore["getSnapshot"]>[0];

/**
 * Keeps Genkit agent snapshots in PostgreSQL so conversations survive restarts
 * and belong to the traveller who started them.
 */
export class PrismaAgentChatStore<S = unknown> implements SessionStore<S> {
	async getSnapshot(
		options: GetSnapshotOptions,
	): Promise<SessionSnapshot<S> | undefined> {
		const row = options.snapshotId
			? await prisma.agentSnapshot.findUnique({
					where: { id: options.snapshotId },
				})
			: options.sessionId
				? await prisma.agentSnapshot.findFirst({
						where: { chatId: options.sessionId },
						orderBy: { createdAt: "desc" },
					})
				: null;

		return row?.data as SessionSnapshot<S> | undefined;
	}

	async saveSnapshot(
		snapshotId: string | undefined,
		mutator: SnapshotMutator<S>,
		_options?: SessionStoreOptions,
	): Promise<string | null> {
		const existing = snapshotId
			? await this.getSnapshot({ snapshotId })
			: undefined;

		const next = await mutator(existing);

		if (!next) {
			return null;
		}

		const id = snapshotId ?? next.snapshotId ?? randomUUID();
		const data = next as unknown as Prisma.InputJsonValue;

		if (!next.sessionId) {
			throw new Error(`Genkit snapshot ${id} arrived without a session id.`);
		}

		await prisma.agentSnapshot.upsert({
			where: { id },
			create: {
				id,
				chatId: next.sessionId,
				parentId: next.parentId ?? null,
				status: String(next.status ?? "in_progress"),
				data,
			},
			update: {
				parentId: next.parentId ?? null,
				status: String(next.status ?? "in_progress"),
				data,
			},
		});

		return id;
	}
}
