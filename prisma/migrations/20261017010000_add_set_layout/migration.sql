-- A set is an object with its own layout (Anytype I.ObjectLayout.Set = 3). Its records
-- are the objects whose type is one of the set's sources, read through a subscription.
ALTER TYPE "ObjectLayout" ADD VALUE 'set';
