-- Space sharing (settings/space/share.tsx, members.tsx -> SpaceInviteGenerate/GetCurrent/
-- Revoke/Change/View, SpaceJoin) hands out a link addressed by an Anytype-style cid + fileKey
-- pair. The self-hosted backend stores that pair on a SpaceInvite row instead of publishing an
-- off-chain invite file. A space keeps at most one non-revoked invite at a time (the "current"
-- invite the client reads and revokes); permissions/inviteType mirror Anytype's numeric
-- ParticipantPermissions/InviteType enums. createdBy holds the actor's user id with no FK,
-- mirroring Obj.deletedBy, so the better-auth User model is untouched. Additive: a space with no
-- invite row simply has nothing to share yet.
CREATE TABLE "SpaceInvite" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "cid" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "inviteType" INTEGER NOT NULL DEFAULT 0,
    "permissions" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpaceInvite_cid_key" ON "SpaceInvite"("cid");

CREATE INDEX "SpaceInvite_spaceId_idx" ON "SpaceInvite"("spaceId");

ALTER TABLE "SpaceInvite" ADD CONSTRAINT "SpaceInvite_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
