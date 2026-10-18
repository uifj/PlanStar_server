-- A date object is the per-day object ObjectDateByTimestamp finds-or-creates for date
-- mentions and date blocks (Anytype I.ObjectLayout.Date === 17). It is a real object row the
-- client links to and opens, so it needs its own layout value. Additive: existing rows keep
-- their enum value.
ALTER TYPE "ObjectLayout" ADD VALUE 'date';
