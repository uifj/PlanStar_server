-- Point-in-time body snapshots for Anytype Rpc.History (component/page/main/history/right.tsx
-- -> HistoryGetVersions/ShowVersion/DiffVersions/SetVersion). A row is written on every collab
-- store (storeDocument), so the History panel can list prior versions, preview a chosen one as an
-- objectView, restore it as the current body, and diff two. authorId carries the last editor
-- resolved from the collab connection session with no FK (mirrors Obj.deletedBy), so the
-- better-auth User model is untouched; it is null when the store path has no session context.
-- state is the raw folded Yjs update, the same shape as DocumentState.state.
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "authorId" TEXT,
    "groupId" TEXT,
    "state" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentVersion_objectId_createdAt_idx" ON "DocumentVersion"("objectId", "createdAt");

CREATE INDEX "DocumentVersion_spaceId_idx" ON "DocumentVersion"("spaceId");

ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "Obj"("id") ON DELETE CASCADE ON UPDATE CASCADE;
