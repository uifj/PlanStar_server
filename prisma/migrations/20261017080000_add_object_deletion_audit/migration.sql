-- The space settings "Deletion audit" page (settings/space/deletionAudit.tsx -> ObjectDeletionAudit)
-- lists what was removed from a space, newest first, and shows who removed each row and when.
-- Deletion here is a soft delete (Obj.isDeleted), so the audit needs a removal timestamp and the
-- removing account, neither of which the isDeleted flag carries. deletedBy stores the actor's user
-- id (mirroring creatorId); the read path projects it to the participant id the client resolves a
-- name from. Both columns are nullable and additive: rows deleted before this migration carry no
-- stamp and sort last, and a delete with no actor (system/GC) leaves deletedBy null.
ALTER TABLE "Obj" ADD COLUMN "deletedDate" TIMESTAMP(3);
ALTER TABLE "Obj" ADD COLUMN "deletedBy" TEXT;
