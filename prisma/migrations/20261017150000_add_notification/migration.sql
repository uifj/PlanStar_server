-- Per-user notifications (Anytype Rpc.Notification). A row stores the wire `type` field name plus a
-- payload JSONB and projects to { id, createTime, status, isLocal, [type]: payload } (see the
-- Notification model comment in schema.prisma). status is Anytype's numeric I.NotificationStatus
-- (Created 0, Shown 1, Read 2, Replied 3); createTime is unix seconds. userId is the recipient with
-- no FK (mirrors ChatMessage.creatorId, to avoid touching the better-auth User model); spaceId
-- cascades so deleting a space clears its notices.

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "isLocal" BOOLEAN NOT NULL DEFAULT false,
    "createTime" BIGINT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_status_idx" ON "Notification"("userId", "status");

-- CreateIndex
CREATE INDEX "Notification_spaceId_idx" ON "Notification"("spaceId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
