-- A discussion is the per-object comment chat ObjectAddDiscussion mints (Anytype
-- I.ObjectLayout.Discussion === 27). It is a real object row the parent points at through
-- its discussionId detail, so it needs its own layout value. Additive: existing rows keep
-- their enum value.
ALTER TYPE "ObjectLayout" ADD VALUE 'discussion';
