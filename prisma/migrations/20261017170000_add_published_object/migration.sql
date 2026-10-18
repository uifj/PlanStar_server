-- Public publishing (menu/publish.tsx, settings/data/publish.tsx -> PublishingCreate/GetStatus/
-- Remove/List). The self-hosted backend has no any.co publishing network, so it stores the publish
-- binding on a PublishedObject row and serves the object's content from a public gateway route keyed
-- by the slug (uri). The client splits the public URL: the domain comes from the participant identity
-- (U.Space.getPublishDomain) and the editable slug is `uri` here, which PublishState.uri round-trips
-- into the menu's slug input. A row exists only while published (PublishingRemove deletes it), so it
-- always projects status Published(1). version is a monotonic re-publish counter (projected as a
-- string); size is the body byte length; timestamp is unix seconds; joinSpace mirrors the share-space
-- toggle. publishedBy holds the actor's user id with no FK, mirroring Obj.deletedBy, so the better-auth
-- User model is untouched. @@unique(uri) makes a slug a globally-unique public address;
-- @@unique(spaceId, objectId) keeps one publish per object so re-publishing upserts. Both FKs cascade.
CREATE TABLE "PublishedObject" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "joinSpace" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "size" INTEGER NOT NULL DEFAULT 0,
    "timestamp" BIGINT NOT NULL,
    "publishedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishedObject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublishedObject_uri_key" ON "PublishedObject"("uri");

CREATE UNIQUE INDEX "PublishedObject_spaceId_objectId_key" ON "PublishedObject"("spaceId", "objectId");

CREATE INDEX "PublishedObject_spaceId_idx" ON "PublishedObject"("spaceId");

ALTER TABLE "PublishedObject" ADD CONSTRAINT "PublishedObject_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PublishedObject" ADD CONSTRAINT "PublishedObject_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "Obj"("id") ON DELETE CASCADE ON UPDATE CASCADE;
