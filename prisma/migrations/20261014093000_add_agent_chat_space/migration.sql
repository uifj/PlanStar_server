-- AlterTable: ADR-0011, a conversation belongs to one space
ALTER TABLE "AgentChat" ADD COLUMN     "spaceId" TEXT;
