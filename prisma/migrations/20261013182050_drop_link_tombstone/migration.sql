-- Object edges are rewritten, not tombstoned (ADR-0003 has no delete history).
ALTER TABLE "Link" DROP COLUMN "deletedAt";
