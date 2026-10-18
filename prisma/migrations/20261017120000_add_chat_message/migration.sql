-- Chat / discussion messages. Append-only per chat; ordering is a monotonic per-chat seq
-- projected to a zero-padded orderId string the client sorts and paginates by lexicographic
-- compare (see the ChatMessage model comment in schema.prisma and ADR-0003). content /
-- attachments / blocks / reactions stay opaque JSONB so the client's nested wire shapes
-- (marks, reaction id-lists, quote blocks) round-trip verbatim. createdAt / modifiedAt are
-- unix seconds (the client's U.Date.date multiplies by 1000).

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "orderId" TEXT NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "reactions" JSONB NOT NULL DEFAULT '{}',
    "replyToMessageId" TEXT NOT NULL DEFAULT '',
    "createdAt" BIGINT NOT NULL,
    "modifiedAt" BIGINT NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_chatId_seq_key" ON "ChatMessage"("chatId", "seq");

-- CreateIndex
CREATE INDEX "ChatMessage_chatId_orderId_idx" ON "ChatMessage"("chatId", "orderId");

-- CreateIndex
CREATE INDEX "ChatMessage_spaceId_idx" ON "ChatMessage"("spaceId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
