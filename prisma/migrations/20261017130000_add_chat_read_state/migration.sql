-- Per-member chat read watermarks. Anytype tracks unread state as an oldestOrderId+counter pair per
-- participant; the web-equivalent stores a high-watermark orderId per read type and derives the
-- counter on read (live messages with orderId > the watermark). See the ChatReadState model comment
-- in schema.prisma. messageOrderId / mentionOrderId advance on ChatReadMessages and move back on
-- ChatUnreadMessages; reactionOrderId advances on ChatReadReactions. lastStateId + order are the
-- optimistic-concurrency token and monotonic version echoed to the client in ChatStateUpdate events.

-- CreateTable
CREATE TABLE "ChatReadState" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageOrderId" TEXT NOT NULL DEFAULT '',
    "mentionOrderId" TEXT NOT NULL DEFAULT '',
    "reactionOrderId" TEXT NOT NULL DEFAULT '',
    "lastStateId" TEXT NOT NULL DEFAULT '',
    "order" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "ChatReadState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatReadState_chatId_userId_key" ON "ChatReadState"("chatId", "userId");

-- CreateIndex
CREATE INDEX "ChatReadState_spaceId_userId_idx" ON "ChatReadState"("spaceId", "userId");

-- AddForeignKey
ALTER TABLE "ChatReadState" ADD CONSTRAINT "ChatReadState_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
