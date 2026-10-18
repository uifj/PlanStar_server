-- A bookmark object carries its own layout (Anytype I.ObjectLayout.Bookmark === 11). The
-- url rides on the `source` relation in the details JSONB; the layout only tells the shell
-- to render the record as a bookmark card. Additive: existing rows keep their enum value.
ALTER TYPE "ObjectLayout" ADD VALUE 'bookmark';
