-- CreateTable
CREATE TABLE "AgentChat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSnapshot" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "parentId" TEXT,
    "status" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentChat_userId_idx" ON "AgentChat"("userId");

-- CreateIndex
CREATE INDEX "AgentSnapshot_chatId_createdAt_idx" ON "AgentSnapshot"("chatId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentChat" ADD CONSTRAINT "AgentChat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSnapshot" ADD CONSTRAINT "AgentSnapshot_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "AgentChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
