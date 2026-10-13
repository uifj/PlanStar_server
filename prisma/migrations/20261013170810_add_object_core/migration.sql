-- CreateEnum
CREATE TYPE "SpaceStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "SpacePermission" AS ENUM ('reader', 'writer', 'admin', 'owner');

-- CreateEnum
CREATE TYPE "SpaceMemberStatus" AS ENUM ('active', 'removed');

-- CreateEnum
CREATE TYPE "RelationFormat" AS ENUM ('shortText', 'longText', 'number', 'date', 'checkbox', 'select', 'multiSelect', 'object');

-- CreateEnum
CREATE TYPE "ObjectLayout" AS ENUM ('basic', 'relation', 'objectType');

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SpaceStatus" NOT NULL DEFAULT 'active',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaceMember" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "SpacePermission" NOT NULL DEFAULT 'reader',
    "status" "SpaceMemberStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relation" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "typeId" TEXT,
    "uniqueKey" TEXT NOT NULL,
    "format" "RelationFormat" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isReadOnly" BOOLEAN NOT NULL DEFAULT false,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "maxCount" INTEGER,
    "defaultValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectType" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "uniqueKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconEmoji" TEXT,
    "layout" "ObjectLayout" NOT NULL DEFAULT 'basic',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Obj" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "typeId" TEXT,
    "layout" "ObjectLayout",
    "resolvedLayout" "ObjectLayout" NOT NULL DEFAULT 'basic',
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "snippet" TEXT,
    "iconEmoji" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "done" BOOLEAN,
    "creatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Obj_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Link" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "relationKey" TEXT NOT NULL,
    "sortOrder" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Space_createdBy_status_idx" ON "Space"("createdBy", "status");

-- CreateIndex
CREATE INDEX "SpaceMember_userId_idx" ON "SpaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceMember_spaceId_userId_key" ON "SpaceMember"("spaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Relation_spaceId_uniqueKey_key" ON "Relation"("spaceId", "uniqueKey");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectType_spaceId_uniqueKey_key" ON "ObjectType"("spaceId", "uniqueKey");

-- CreateIndex
CREATE INDEX "Obj_spaceId_resolvedLayout_idx" ON "Obj"("spaceId", "resolvedLayout");

-- CreateIndex
CREATE INDEX "Obj_spaceId_typeId_idx" ON "Obj"("spaceId", "typeId");

-- CreateIndex
CREATE INDEX "Obj_spaceId_isDeleted_isArchived_idx" ON "Obj"("spaceId", "isDeleted", "isArchived");

-- CreateIndex
CREATE INDEX "Link_toId_relationKey_idx" ON "Link"("toId", "relationKey");

-- CreateIndex
CREATE INDEX "Link_spaceId_idx" ON "Link"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Link_fromId_relationKey_toId_key" ON "Link"("fromId", "relationKey", "toId");

-- AddForeignKey
ALTER TABLE "Space" ADD CONSTRAINT "Space_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relation" ADD CONSTRAINT "Relation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectType" ADD CONSTRAINT "ObjectType_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obj" ADD CONSTRAINT "Obj_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obj" ADD CONSTRAINT "Obj_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ObjectType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obj" ADD CONSTRAINT "Obj_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Obj"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Obj"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Relation_typeId_idx" ON "Relation"("typeId");

-- AddForeignKey
ALTER TABLE "Relation" ADD CONSTRAINT "Relation_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ObjectType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- GIN index over the open details map; Prisma cannot express operator classes (ADR-0002).
CREATE INDEX obj_details_gin ON "Obj" USING gin (details jsonb_path_ops);
