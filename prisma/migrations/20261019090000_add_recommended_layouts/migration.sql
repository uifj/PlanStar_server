-- A type can recommend one of the page-format layouts the client's type sidebar offers
-- (front_web interface/object.ts: Human === 1, Task === 2, Note === 9; Page === 0 is the existing
-- `basic`). Objects inherit that recommendation and ObjectTypeResolveLayoutConflicts resets them to
-- it, so the column has to be able to hold the layout the type asked for. Additive: existing rows
-- keep their enum value.
ALTER TYPE "ObjectLayout" ADD VALUE 'human';
ALTER TYPE "ObjectLayout" ADD VALUE 'task';
ALTER TYPE "ObjectLayout" ADD VALUE 'note';
