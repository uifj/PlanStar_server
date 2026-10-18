-- The vault lets a caller pin and drag-reorder their spaces (sidebar/page/vault.tsx:198,
-- lib/util/menu.ts:881 -> SpaceSetOrder). That arrangement is personal, not a property of the
-- space, so it lives on the membership row rather than on the space's shared spaceView object:
-- two members of the same (e.g. VanLife) space each keep their own order. The value is a
-- zero-padded positional key compared as a string, mirroring ObjectType.orderId. Additive:
-- existing memberships keep the empty default, which the client reads as "not pinned".
ALTER TABLE "SpaceMember" ADD COLUMN "orderId" TEXT NOT NULL DEFAULT '';
