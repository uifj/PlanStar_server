-- CreateEnum
CREATE TYPE "BlockType" AS ENUM ('text', 'link');

-- CreateEnum
CREATE TYPE "BlockStyle" AS ENUM ('paragraph', 'heading1', 'heading2', 'heading3', 'quote', 'code', 'bulleted', 'numbered', 'toggle');

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "BlockType" NOT NULL,
    "style" "BlockStyle" NOT NULL DEFAULT 'paragraph',
    "text" TEXT NOT NULL DEFAULT '',
    "linkTargetId" TEXT,
    "index" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Block_objectId_parentId_index_idx" ON "Block"("objectId", "parentId", "index");

-- CreateIndex
CREATE INDEX "Block_linkTargetId_idx" ON "Block"("linkTargetId");

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "Obj"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Block"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_linkTargetId_fkey" FOREIGN KEY ("linkTargetId") REFERENCES "Obj"("id") ON DELETE SET NULL ON UPDATE CASCADE;
