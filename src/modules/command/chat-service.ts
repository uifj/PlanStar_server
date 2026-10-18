import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { participantId } from "./registry-service.js";

// A creator filter arrives in whichever form the client happens to hold: the global search bar sends
// the bare account id (popup/search.tsx:2202 → getTokenIdentity), while the object-search token filter
// (search.tsx:2108) also pushes this space's participant id alongside it. A participant id of THIS
// space decodes to its account id; anything else is read as an account id as-is, so a foreign space's
// participant id simply matches no creatorId here rather than silently widening the query.
function creatorUserIds(spaceId: string, creators: string[]): string[] {
	const prefix = `_participant_${spaceId.replace(/\./g, "_")}_`;
	const ids = new Set<string>();
	for (const identity of creators) {
		const userId = identity.startsWith(prefix)
			? identity.slice(prefix.length)
			: identity;
		if (userId.length > 0) {
			ids.add(userId);
		}
	}
	return [...ids];
}

// A stored row projected to the wire ChatMessage shape Mapper.From.ChatMessage reads: the body text
// lives under `message`, timestamps are unix seconds (the client's U.Date.date multiplies by 1000),
// and the creator is the ACCOUNT id — block/chat/message/index.tsx:89 compares it directly with
// account.id and :250 wraps it again in U.Space.getParticipantId(space, creator), so a participant id
// would double-prefix and render every message as someone else's. Read/mention/reaction flags default
// to the values a freshly loaded message carries; read receipts are a later slice.
export interface ChatRecord {
	id: string;
	orderId: string;
	creator: string;
	createdAt: number;
	modifiedAt: number;
	replyToMessageId: string;
	message: unknown;
	attachments: unknown;
	reactions: unknown;
	blocks: unknown;
	read: boolean;
	mentionRead: boolean;
	unreadReaction: boolean;
	hasMention: boolean;
	synced: boolean;
	pinned: boolean;
	deleted: boolean;
}

interface ChatRow {
	id: string;
	orderId: string;
	creatorId: string;
	createdAt: bigint;
	modifiedAt: bigint;
	replyToMessageId: string;
	content: Prisma.JsonValue;
	attachments: Prisma.JsonValue;
	reactions: Prisma.JsonValue;
	blocks: Prisma.JsonValue;
	pinned: boolean;
	deleted: boolean;
}

function chatMessageRecord(row: ChatRow): ChatRecord {
	return {
		id: row.id,
		orderId: row.orderId,
		creator: row.creatorId,
		createdAt: Number(row.createdAt),
		modifiedAt: Number(row.modifiedAt),
		replyToMessageId: row.replyToMessageId,
		message: row.content,
		attachments: row.attachments,
		reactions: row.reactions,
		blocks: row.blocks,
		read: false,
		mentionRead: false,
		unreadReaction: false,
		hasMention: false,
		synced: true,
		pinned: row.pinned,
		deleted: row.deleted,
	};
}

function jsonOr(value: unknown, fallback: Prisma.InputJsonValue) {
	return (value === undefined ? fallback : value) as Prisma.InputJsonValue;
}

// Append a message to a chat. The client posts the mapped wire message but leaves id/orderId/creator/
// timestamps empty (form.tsx sends only content/attachments/reactions/blocks/replyToMessageId), so the
// server is authoritative: it mints the id, stamps the creator and createdAt (unix seconds), and
// assigns seq inside a transaction that locks the chat's Obj row. The lock serializes concurrent posts
// to the same chat, so two writers never collide on @@unique([chatId, seq]). orderId is the zero-padded
// seq — fixed width so the client's lexicographic sort/pagination key matches numeric order (ADR-0003).
export async function addMessage(
	chatObjectId: string,
	spaceId: string,
	creatorId: string,
	wire: Record<string, unknown>,
): Promise<ChatRecord> {
	const row = await prisma.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT "id" FROM "Obj" WHERE "id" = ${chatObjectId} FOR UPDATE`;

		const last = await tx.chatMessage.findFirst({
			where: { chatId: chatObjectId },
			orderBy: { seq: "desc" },
			select: { seq: true },
		});
		const seq = (last?.seq ?? 0n) + 1n;
		const now = BigInt(Math.floor(Date.now() / 1000));

		return tx.chatMessage.create({
			data: {
				chatId: chatObjectId,
				spaceId,
				creatorId,
				seq,
				orderId: seq.toString().padStart(12, "0"),
				content: jsonOr(wire.message, {}),
				attachments: jsonOr(wire.attachments, []),
				blocks: jsonOr(wire.blocks, []),
				reactions: jsonOr(wire.reactions, {}),
				replyToMessageId:
					typeof wire.replyToMessageId === "string"
						? wire.replyToMessageId
						: "",
				createdAt: now,
				// 0 = never edited. The client's "(edited)" label fires for ANY non-zero
				// modifiedAt (block/chat/message/index.tsx:261), so stamping the creation time
				// here would mark every message edited the moment it is posted; only
				// editMessage sets it.
				modifiedAt: 0n,
				pinned: Boolean(wire.pinned),
			},
		});
	});

	return chatMessageRecord(row);
}

export interface ChatStateCounter {
	oldestOrderId: string;
	counter: number;
}

// The wire ChatState the client's From.ChatState reads (mapper.ts:858). messages/mentions are
// { oldestOrderId, counter } pairs; unreadReactionOrderId is the oldest message with an unseen
// reaction; lastStateId + order are the version token the client echoes back on the next read.
export interface ChatStateWire {
	messages: ChatStateCounter;
	mentions: ChatStateCounter;
	unreadReactionOrderId: string;
	lastStateId: string;
	order: number;
}

export interface ChatPage {
	messages: ChatRecord[];
	chatState: ChatStateWire;
}

const MARK_MENTION = 8;

function markList(value: unknown): { type?: number; param?: unknown }[] {
	return Array.isArray(value)
		? (value as { type?: number; param?: unknown }[])
		: [];
}

function mentionsCaller(
	content: Prisma.JsonValue,
	blocks: Prisma.JsonValue,
	caller: string,
): boolean {
	const isMention = (m: { type?: number; param?: unknown }) =>
		m?.type === MARK_MENTION && m?.param === caller;

	const body = content as { marks?: unknown } | null;
	if (markList(body?.marks).some(isMention)) {
		return true;
	}
	const list = Array.isArray(blocks)
		? (blocks as { text?: { marks?: unknown } }[])
		: [];
	for (const block of list) {
		if (markList(block?.text?.marks).some(isMention)) {
			return true;
		}
	}
	return false;
}

function hasReactions(reactions: Prisma.JsonValue): boolean {
	const map =
		(reactions as { reactions?: Record<string, unknown> } | null)?.reactions ??
		{};
	return Object.keys(map).length > 0;
}

// Project the caller's unread state for one chat. Anytype stores an oldestOrderId+counter per
// participant; the web-equivalent stores a high-watermark orderId per read type (ChatReadState) and
// derives the counters here. A single scan of the unread window — bounded by the most-behind cursor,
// where "" sorts below every real orderId so an untouched cursor scans the whole chat — feeds all
// three counters. Unread messages are live rows with orderId > the message watermark; unread mentions
// are the subset whose content/blocks carry a mention mark (MarkType.Mention=8) naming the caller;
// the reaction cursor points at the oldest live row above it that has any reaction.
export async function computeChatState(
	chatObjectId: string,
	spaceId: string,
	userId: string,
): Promise<ChatStateWire> {
	const state = await prisma.chatReadState.findUnique({
		where: { chatId_userId: { chatId: chatObjectId, userId } },
	});
	const messageOrderId = state?.messageOrderId ?? "";
	const mentionOrderId = state?.mentionOrderId ?? "";
	const reactionOrderId = state?.reactionOrderId ?? "";

	const floor = [messageOrderId, mentionOrderId, reactionOrderId].reduce(
		(min, cur) => (cur < min ? cur : min),
		messageOrderId,
	);

	const rows = await prisma.chatMessage.findMany({
		where: { chatId: chatObjectId, deleted: false, orderId: { gt: floor } },
		select: { orderId: true, content: true, blocks: true, reactions: true },
		orderBy: { orderId: "asc" },
	});

	const caller = participantId(spaceId, userId);
	const messages: ChatStateCounter = { oldestOrderId: "", counter: 0 };
	const mentions: ChatStateCounter = { oldestOrderId: "", counter: 0 };
	let unreadReactionOrderId = "";

	for (const row of rows) {
		if (row.orderId > messageOrderId) {
			messages.counter++;
			if (!messages.oldestOrderId) {
				messages.oldestOrderId = row.orderId;
			}
		}
		if (
			row.orderId > mentionOrderId &&
			mentionsCaller(row.content, row.blocks, caller)
		) {
			mentions.counter++;
			if (!mentions.oldestOrderId) {
				mentions.oldestOrderId = row.orderId;
			}
		}
		if (row.orderId > reactionOrderId && hasReactions(row.reactions)) {
			if (!unreadReactionOrderId) {
				unreadReactionOrderId = row.orderId;
			}
		}
	}

	return {
		messages,
		mentions,
		unreadReactionOrderId,
		lastStateId: state?.lastStateId ?? "",
		order: Number(state?.order ?? 0n),
	};
}

// Advance the caller's read watermark for one read type (I.ChatReadType: Message=0, Mention=1) to
// beforeOrderId. Reading is a high-watermark — it only ever moves forward, so reading an older window
// after a newer one is a no-op (block/chat.tsx:286 notes C.ChatReadMessages is irreversible). A real
// change bumps order and mints a fresh lastStateId; a read that moves nothing returns the state
// untouched, because the client applies a ChatStateUpdate only when its order is GREATER than the one
// it holds (store/chat.ts:432) — minting an order for a no-op would mutate the store on every reply,
// and the chat block re-fires its read from that re-render (block/chat.tsx:1564), an endless
// ChatReadMessages storm. The counter is derived on read, never stored.
export async function readMessages(
	chatObjectId: string,
	spaceId: string,
	userId: string,
	beforeOrderId: string,
	type: number,
): Promise<ChatStateWire> {
	const where = { chatId_userId: { chatId: chatObjectId, userId } } as const;
	const existing = await prisma.chatReadState.findUnique({ where });

	const isMention = type === 1;
	const current = isMention
		? (existing?.mentionOrderId ?? "")
		: (existing?.messageOrderId ?? "");
	const next = beforeOrderId > current ? beforeOrderId : current;
	if (next === current) {
		return computeChatState(chatObjectId, spaceId, userId);
	}

	const order = (existing?.order ?? 0n) + 1n;
	const lastStateId = order.toString();
	const watermark = isMention
		? { mentionOrderId: next }
		: { messageOrderId: next };

	await prisma.chatReadState.upsert({
		where,
		create: {
			chatId: chatObjectId,
			spaceId,
			userId,
			lastStateId,
			order,
			...watermark,
		},
		update: { lastStateId, order, ...watermark },
	});

	return computeChatState(chatObjectId, spaceId, userId);
}

// The inverse of readMessages: move the caller's message watermark back so afterOrderId and
// everything newer is unread again ("mark unread from here"). The watermark becomes the newest live
// message strictly before afterOrderId — derived from a real row rather than by decrementing the
// orderId, so it stays correct if the ordering scheme ever changes — or "" when nothing precedes it
// (the whole chat is unread). Only the message watermark moves; the command carries no read type, so
// the mention/reaction cursors are untouched. Returns the recomputed state for the ChatStateUpdate
// event.
export async function unreadMessages(
	chatObjectId: string,
	spaceId: string,
	userId: string,
	afterOrderId: string,
): Promise<ChatStateWire> {
	const prior = await prisma.chatMessage.findFirst({
		where: {
			chatId: chatObjectId,
			deleted: false,
			orderId: { lt: afterOrderId },
		},
		orderBy: { orderId: "desc" },
		select: { orderId: true },
	});
	const messageOrderId = prior?.orderId ?? "";

	const where = { chatId_userId: { chatId: chatObjectId, userId } } as const;
	const existing = await prisma.chatReadState.findUnique({ where });
	// Nothing moves, so nothing is announced — same rule as readMessages.
	if ((existing?.messageOrderId ?? "") === messageOrderId) {
		return computeChatState(chatObjectId, spaceId, userId);
	}
	const order = (existing?.order ?? 0n) + 1n;
	const lastStateId = order.toString();

	await prisma.chatReadState.upsert({
		where,
		create: {
			chatId: chatObjectId,
			spaceId,
			userId,
			messageOrderId,
			lastStateId,
			order,
		},
		update: { messageOrderId, lastStateId, order },
	});

	return computeChatState(chatObjectId, spaceId, userId);
}

// Advance the caller's reaction watermark to orderId (high-watermark, like readMessages). The
// chatState.unreadReactionOrderId projection then points at the oldest live message above it that
// carries any reaction — the client's "new reactions" jump marker (block/chat.tsx:1311). Returns the
// recomputed state for the ChatStateUpdate event.
export async function readReactions(
	chatObjectId: string,
	spaceId: string,
	userId: string,
	orderId: string,
): Promise<ChatStateWire> {
	const where = { chatId_userId: { chatId: chatObjectId, userId } } as const;
	const existing = await prisma.chatReadState.findUnique({ where });
	const current = existing?.reactionOrderId ?? "";
	const reactionOrderId = orderId > current ? orderId : current;
	// A marker that does not move must not mint a new order (see readMessages).
	if (reactionOrderId === current) {
		return computeChatState(chatObjectId, spaceId, userId);
	}
	const order = (existing?.order ?? 0n) + 1n;
	const lastStateId = order.toString();

	await prisma.chatReadState.upsert({
		where,
		create: {
			chatId: chatObjectId,
			spaceId,
			userId,
			reactionOrderId,
			lastStateId,
			order,
		},
		update: { reactionOrderId, lastStateId, order },
	});

	return computeChatState(chatObjectId, spaceId, userId);
}

// Mark every chat in the caller's active spaces fully read (the ChatReadAll shortcut). For each chat
// that has messages, the message + mention watermarks jump to the chat's newest orderId, so the derived
// counters fall to zero. Only the caller's own ChatReadState rows are written — one member clearing
// their badges never touches another's. Chats with no messages are skipped (their counters are already
// zero). Returns the number of chats touched. No push event: a single envelope carries one contextId
// and this spans many chats, so the client re-reads each chat's state on its next subscribe.
export async function readAllChats(userId: string): Promise<number> {
	const memberships = await prisma.spaceMember.findMany({
		where: { userId, status: "active" },
		select: { spaceId: true },
	});
	const spaceIds = memberships.map((m) => m.spaceId);
	if (spaceIds.length === 0) {
		return 0;
	}

	// One row per chat with its newest orderId (max over the zero-padded orderId is the newest, since
	// lexicographic order matches numeric order). Deleted messages still bound the watermark correctly.
	const chats = await prisma.chatMessage.groupBy({
		by: ["chatId", "spaceId"],
		where: { spaceId: { in: spaceIds } },
		_max: { orderId: true },
	});

	let touched = 0;
	for (const chat of chats) {
		const newest = chat._max.orderId ?? "";
		if (!newest) {
			continue;
		}
		const where = { chatId_userId: { chatId: chat.chatId, userId } } as const;
		const existing = await prisma.chatReadState.findUnique({ where });
		const order = (existing?.order ?? 0n) + 1n;
		const lastStateId = order.toString();
		await prisma.chatReadState.upsert({
			where,
			create: {
				chatId: chat.chatId,
				spaceId: chat.spaceId,
				userId,
				messageOrderId: newest,
				mentionOrderId: newest,
				lastStateId,
				order,
			},
			update: {
				messageOrderId: newest,
				mentionOrderId: newest,
				lastStateId,
				order,
			},
		});
		touched++;
	}
	return touched;
}

export interface ChatPreviewWire {
	spaceId: string;
	chatObjectId: string;
	message: ChatRecord;
	state: ChatStateWire;
	dependencies: unknown[];
}

// The space chat list (ChatSubscribeToMessagePreviews, fired once for the chatSpace subId in
// util/data.ts:508): one preview per chat in the caller's active spaces that has a live message. Each
// preview carries that chat's newest live message (From.ChatPreview reads `message`) and the caller's
// unread projection (computeChatState feeds `state`), so the list shows the last message plus a live
// badge per chat, newest activity first. Dependencies stay empty — the web backend does not resolve a
// message's referenced objects here, matching every other chat read. Scoped to the caller's own
// memberships, so it never surfaces another member's private chats and needs no space-access check.
export async function getMessagePreviews(
	userId: string,
): Promise<ChatPreviewWire[]> {
	const memberships = await prisma.spaceMember.findMany({
		where: { userId, status: "active" },
		select: { spaceId: true },
	});
	const spaceIds = memberships.map((m) => m.spaceId);
	if (spaceIds.length === 0) {
		return [];
	}

	// DISTINCT ON picks each chat's newest live message (highest orderId) in one pass; the outer sort
	// orders the chats by that message's recency. Postgres-specific, like searchMessages' ILIKE.
	const rows = await prisma.$queryRaw<
		(ChatRow & { chatId: string; spaceId: string })[]
	>(Prisma.sql`
		SELECT * FROM (
			SELECT DISTINCT ON ("chatId")
				"chatId", "spaceId", "id", "orderId", "creatorId", "createdAt", "modifiedAt",
				"replyToMessageId", "content", "attachments", "reactions", "blocks", "pinned", "deleted"
			FROM "ChatMessage"
			WHERE "deleted" = false AND "spaceId" IN (${Prisma.join(spaceIds)})
			ORDER BY "chatId", "orderId" DESC
		) latest
		ORDER BY "createdAt" DESC
	`);

	const previews: ChatPreviewWire[] = [];
	for (const row of rows) {
		previews.push({
			spaceId: row.spaceId,
			chatObjectId: row.chatId,
			message: chatMessageRecord(row),
			state: await computeChatState(row.chatId, row.spaceId, userId),
			dependencies: [],
		});
	}
	return previews;
}

// Page a chat's history by orderId (ascending). beforeOrderId selects the window ending at the cursor
// (the newest `limit` messages older than it — block/chat.tsx:467 loads older history); afterOrderId
// selects the window starting at the cursor (the oldest `limit` newer than it — chat.tsx:468 loads
// newer). includeBoundary widens the comparison to include the cursor message itself (jump-to-message
// fetches the target inclusively, chat.tsx:663). With neither cursor, returns the latest `limit`.
// Soft-deleted messages are excluded so a deleted message stays gone on reload; comment tombstones are
// a separate (discussion) read path. The chatState is the CALLER's unread projection, so the paging
// reads carry the viewer's userId.
export async function getMessages(
	chatObjectId: string,
	spaceId: string,
	userId: string,
	beforeOrderId: string,
	afterOrderId: string,
	limit: number,
	includeBoundary: boolean,
): Promise<ChatPage> {
	const take = limit > 0 ? limit : 50;

	const orderId: Record<string, string> = {};
	if (beforeOrderId) {
		orderId[includeBoundary ? "lte" : "lt"] = beforeOrderId;
	}
	if (afterOrderId) {
		orderId[includeBoundary ? "gte" : "gt"] = afterOrderId;
	}
	const where: Prisma.ChatMessageWhereInput = {
		chatId: chatObjectId,
		deleted: false,
		...(Object.keys(orderId).length ? { orderId } : {}),
	};

	// A before-cursor (or no cursor) wants the page adjacent to the newest matching message, so read
	// descending, take, then flip back to ascending. An after-cursor reads the oldest matching forward.
	const descending = Boolean(beforeOrderId) || !afterOrderId;
	const rows = await prisma.chatMessage.findMany({
		where,
		orderBy: { orderId: descending ? "desc" : "asc" },
		take,
	});
	if (descending) {
		rows.reverse();
	}

	return {
		messages: rows.map((row) => chatMessageRecord(row)),
		chatState: await computeChatState(chatObjectId, spaceId, userId),
	};
}

// Hydrate specific messages by id — the client resolves a reply's parent and a message's
// dependencies this way (command.ts:2063). Returns them in the requested id order, skipping ids that
// are missing or soft-deleted (a deleted parent shows as a tombstone the client renders itself, so it
// must not come back as a live row).
export async function getMessagesByIds(
	chatObjectId: string,
	messageIds: string[],
): Promise<ChatRecord[]> {
	if (messageIds.length === 0) {
		return [];
	}

	const rows = await prisma.chatMessage.findMany({
		where: { chatId: chatObjectId, id: { in: messageIds }, deleted: false },
	});
	const byId = new Map(rows.map((row) => [row.id, row]));

	const ordered: ChatRecord[] = [];
	for (const id of messageIds) {
		const row = byId.get(id);
		if (row) {
			ordered.push(chatMessageRecord(row));
		}
	}
	return ordered;
}

export type ChatMutation = "ok" | "not_found" | "forbidden";

// Soft-delete a message so it drops out of every read path but the row survives (Anytype keeps a
// tombstone; a reply's parent still resolves to "deleted"). Only the creator may delete their own
// message; `canModerate` (a space admin/owner) lifts that so moderators can remove anyone's. Returns
// a discriminated result so the command can answer NOT_FOUND vs FORBIDDEN without a second lookup.
export async function deleteMessage(
	chatObjectId: string,
	messageId: string,
	actorUserId: string,
	canModerate: boolean,
): Promise<ChatMutation> {
	const row = await prisma.chatMessage.findFirst({
		where: { chatId: chatObjectId, id: messageId, deleted: false },
		select: { creatorId: true },
	});
	if (!row) {
		return "not_found";
	}
	if (row.creatorId !== actorUserId && !canModerate) {
		return "forbidden";
	}

	await prisma.chatMessage.update({
		where: { id: messageId },
		data: { deleted: true },
	});
	return "ok";
}

export interface ChatEditResult {
	status: ChatMutation;
	record: ChatRecord | null;
}

// Rewrite a message's body. The client posts the full wire message (content under `message`, plus
// attachments/blocks); the server keeps id/orderId/creator/createdAt authoritative, overwrites only
// the body fields present, and bumps modifiedAt. Only the creator may edit — there is no moderator
// override, since rewriting someone else's words is not a moderation power. A missing or already
// deleted message is not_found.
export async function editMessage(
	chatObjectId: string,
	messageId: string,
	actorUserId: string,
	wire: Record<string, unknown>,
): Promise<ChatEditResult> {
	const row = await prisma.chatMessage.findFirst({
		where: { chatId: chatObjectId, id: messageId, deleted: false },
	});
	if (!row) {
		return { status: "not_found", record: null };
	}
	if (row.creatorId !== actorUserId) {
		return { status: "forbidden", record: null };
	}

	const data: Prisma.ChatMessageUpdateInput = {
		modifiedAt: BigInt(Math.floor(Date.now() / 1000)),
	};
	if (wire.message !== undefined) {
		data.content = wire.message as Prisma.InputJsonValue;
	}
	if (wire.attachments !== undefined) {
		data.attachments = wire.attachments as Prisma.InputJsonValue;
	}
	if (wire.blocks !== undefined) {
		data.blocks = wire.blocks as Prisma.InputJsonValue;
	}

	const updated = await prisma.chatMessage.update({
		where: { id: messageId },
		data,
	});
	return { status: "ok", record: chatMessageRecord(updated) };
}

export interface ChatReactionResult {
	status: Extract<ChatMutation, "ok" | "not_found">;
	// The full wire reactions map ({ reactions: { [emoji]: { ids } } }) after the toggle, ready to
	// hand to the ChatUpdateReactions event (From.ChatMessageReaction reads .reactions).
	reactions: { reactions: Record<string, { ids: string[] }> };
}

// Add or remove the caller's reaction. Reactions live in the wire shape { reactions: { [emoji]:
// { ids: accountId[] } } } — From.ChatMessageReaction (mapper.ts:969) turns each bucket into
// { icon, authors: ids } and message/reaction.tsx:18 tests authors.includes(account.id), so the
// caller is stored as their ACCOUNT id. Toggling flips membership, and an
// emoji left with no ids is dropped so the map never carries empty buckets. Any member may react to
// any message, so there is no creator check — only a missing/deleted message is not_found.
export async function toggleReaction(
	chatObjectId: string,
	messageId: string,
	actorUserId: string,
	emoji: string,
): Promise<ChatReactionResult> {
	const row = await prisma.chatMessage.findFirst({
		where: { chatId: chatObjectId, id: messageId, deleted: false },
		select: { reactions: true },
	});
	if (!row) {
		return { status: "not_found", reactions: { reactions: {} } };
	}

	const caller = actorUserId;
	const stored = row.reactions as {
		reactions?: Record<string, { ids?: string[] }>;
	};
	const map: Record<string, { ids: string[] }> = {};
	for (const [key, entry] of Object.entries(stored?.reactions ?? {})) {
		map[key] = { ids: entry?.ids ?? [] };
	}

	const ids = map[emoji]?.ids ?? [];
	const next = ids.includes(caller)
		? ids.filter((id) => id !== caller)
		: [...ids, caller];

	if (next.length === 0) {
		delete map[emoji];
	} else {
		map[emoji] = { ids: next };
	}

	const reactions = { reactions: map };
	await prisma.chatMessage.update({
		where: { id: messageId },
		data: { reactions: reactions as Prisma.InputJsonValue },
	});
	return { status: "ok", reactions };
}

// Flag/unflag messages as pinned. Only live (non-deleted) messages in this chat are touched; the
// updated rows are projected back so the command can emit one ChatUpdatePinnedStatus event per id.
export async function setPinned(
	chatObjectId: string,
	messageIds: string[],
	pinned: boolean,
): Promise<ChatRecord[]> {
	if (messageIds.length === 0) {
		return [];
	}

	const where: Prisma.ChatMessageWhereInput = {
		chatId: chatObjectId,
		id: { in: messageIds },
		deleted: false,
	};
	await prisma.chatMessage.updateMany({ where, data: { pinned } });

	const rows = await prisma.chatMessage.findMany({ where });
	return rows.map((row) => chatMessageRecord(row));
}

// The chat block's pinned bar (block/chat.tsx:919): every live pinned message, ascending by orderId.
export async function getPinned(chatObjectId: string): Promise<ChatRecord[]> {
	const rows = await prisma.chatMessage.findMany({
		where: { chatId: chatObjectId, pinned: true, deleted: false },
		orderBy: { orderId: "asc" },
	});
	return rows.map((row) => chatMessageRecord(row));
}

export interface ChatSearchHit {
	spaceId: string;
	chatId: string;
	messageId: string;
	score: number;
	highlight: string;
	highlightRanges: unknown[];
	message: ChatRecord;
}

// In-chat full-text search over the stored body text (content->>'text'), case-insensitive to match
// every other search in the app. Scoped to one chat, newest-first (seq desc), paginated by
// offset/limit, optionally narrowed to specific creators (see creatorUserIds — both the account id
// and this space's participant id address a person). Soft-deleted messages never surface. Raw SQL
// because Prisma's JSON path filter has no case-insensitive string match; the query is fully
// parameterized (Prisma.sql/join) so the search text and creator list cannot inject.
export async function searchMessages(
	spaceId: string,
	chatObjectId: string,
	fullText: string,
	offset: number,
	limit: number,
	creators: string[],
): Promise<ChatSearchHit[]> {
	const take = limit > 0 ? limit : 20;
	const skip = offset > 0 ? offset : 0;

	const creatorFilterIds = creatorUserIds(spaceId, creators);
	// A creators filter that names nobody matches nothing.
	if (creators.length > 0 && creatorFilterIds.length === 0) {
		return [];
	}
	const creatorFilter = creatorFilterIds.length
		? Prisma.sql`AND "creatorId" IN (${Prisma.join(creatorFilterIds)})`
		: Prisma.empty;

	const pattern = `%${fullText}%`;
	const rows = await prisma.$queryRaw<ChatRow[]>(Prisma.sql`
		SELECT "id", "orderId", "creatorId", "createdAt", "modifiedAt", "replyToMessageId",
		       "content", "attachments", "reactions", "blocks", "pinned", "deleted"
		FROM "ChatMessage"
		WHERE "chatId" = ${chatObjectId}
		  AND "deleted" = false
		  AND "content"->>'text' ILIKE ${pattern}
		  ${creatorFilter}
		ORDER BY "seq" DESC
		LIMIT ${take} OFFSET ${skip}
	`);

	return rows.map((row) => ({
		spaceId,
		chatId: chatObjectId,
		messageId: row.id,
		score: 1,
		highlight: "",
		highlightRanges: [],
		message: chatMessageRecord(row),
	}));
}
