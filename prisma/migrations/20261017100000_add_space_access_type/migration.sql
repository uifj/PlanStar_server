-- The share sheet flips a space between Private and Shared before/after minting an invite
-- (settings/space/share.tsx onLinkToggle -> SpaceMakeShareable / Action.inviteRevoke ->
-- SpaceStopSharing). The client derives `isShared` from the spaceView record's spaceAccessType
-- (store/detail.ts:576, I.SpaceAccessType Shared = 2), which was previously hardcoded to 0, so a
-- shared space never reflected its state. Persist Anytype's numeric SpaceAccessType on the Space
-- row and project it through spaceViewRecord. Additive: existing spaces stay Private (0).
ALTER TABLE "Space" ADD COLUMN "spaceAccessType" INTEGER NOT NULL DEFAULT 0;
