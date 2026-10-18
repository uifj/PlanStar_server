-- CreateTable
CREATE TABLE "RelationOption" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "relationKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelationOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RelationOption_spaceId_relationKey_idx" ON "RelationOption"("spaceId", "relationKey");

-- AddForeignKey
ALTER TABLE "RelationOption" ADD CONSTRAINT "RelationOption_spaceId_relationKey_fkey" FOREIGN KEY ("spaceId", "relationKey") REFERENCES "Relation"("spaceId", "uniqueKey") ON DELETE CASCADE ON UPDATE CASCADE;
