-- The Bin's "Suggested for cleanup" tab (component/page/main/archiveSuggested.tsx ->
-- ObjectCleanupSuggestions) lists orphaned objects the user may want to remove. Some orphans are
-- intentional and should never be nagged about, so ObjectCleanupSuggestionIgnore lets the user
-- permanently dismiss a row — and, by walking createdInContext, its descendants — without deleting
-- or archiving anything. The dismissal is reversible (ignored=false) and is durable per-object
-- state, which needs a column: cleanupIgnored. Additive and defaulted false, so every existing
-- object stays a cleanup candidate until the user dismisses it.
ALTER TABLE "Obj" ADD COLUMN "cleanupIgnored" BOOLEAN NOT NULL DEFAULT false;
